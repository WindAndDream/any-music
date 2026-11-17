//! One transport reader owns protocol ordering. Command waits never discard page events.
//! Embedded account pages and CDP WebSockets share this reader through `Transport` frames.
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

type Reply = oneshot::Sender<Result<Value, String>>;

/// Network.dataReceived and page lifecycle noise can fill the event queue while an
/// actor awaits getResponseBody. Keep only the transitions consumed by account flows.
#[derive(Default)]
struct Events {
    requests: HashSet<(String, String)>,
}
impl Events {
    fn retain(&mut self, event: &Value) -> bool {
        let key = || {
            (
                event["sessionId"].as_str().unwrap_or("").to_owned(),
                event["params"]["requestId"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned(),
            )
        };
        match event["method"].as_str() {
            Some("Network.requestWillBeSent" | "Network.responseReceived") => {
                if !matches!(
                    event["params"]["type"].as_str(),
                    Some("Document" | "XHR" | "Fetch")
                ) {
                    return false;
                }
                self.requests.insert(key());
                true
            }
            Some("Network.loadingFinished" | "Network.loadingFailed") => {
                self.requests.remove(&key())
                    || event["params"]["errorText"]
                        .as_str()
                        .is_some_and(crate::network::proxy_routing::is_browser_proxy_failure)
            }
            Some("Fetch.requestPaused") => true,
            Some("Target.detachedFromTarget") => {
                if let Some(session) = event["params"]["sessionId"].as_str() {
                    self.requests.retain(|(owner, _)| owner != session);
                }
                false
            }
            _ => false,
        }
    }
}

/// A timeout/select can drop a command future at any await. Release its reply slot
/// even when control never reaches the end of call_budget; late replies are ignored.
struct PendingCall {
    id: u64,
    replies: Arc<Mutex<HashMap<u64, Reply>>>,
}
impl Drop for PendingCall {
    fn drop(&mut self) {
        self.replies.lock().unwrap().remove(&self.id);
    }
}
fn protocol_error(error: &Value) -> String {
    // The embedded-page driver reports fixed native product messages.
    if error["native"] == true
        && let Some(message) = error["message"].as_str()
    {
        return message.into();
    }
    // Recognize fixed protocol diagnostics without exposing variable upstream URLs/tokens.
    match error["message"].as_str() {
        Some(
            "No resource with given identifier found"
            | "No data found for resource with given identifier",
        ) => "response-body-unavailable:页面跳转后响应体已失效。",
        Some("Hidden target can be created only when remote debugging is enabled") => {
            "当前浏览器需要初始页面才能创建隐藏页面。"
        }
        _ => "浏览器不支持当前操作。",
    }
    .into()
}
/// A protocol frame from the transport, or the fixed reason it ended.
pub type Frame = Result<Value, &'static str>;

pub struct Cdp {
    outgoing: mpsc::Sender<Value>,
    pending: Arc<Mutex<HashMap<u64, Reply>>>,
    next: u64,
    pub events: mpsc::Receiver<Value>,
    stopped: CancellationToken,
    reason: Arc<Mutex<&'static str>>,
}
impl Drop for Cdp {
    fn drop(&mut self) {
        self.stopped.cancel();
    }
}
impl Cdp {
    pub fn stopped_for_replacement(&self) {
        self.stopped.cancel();
    }
    pub async fn connect(url: &str, parent: &CancellationToken) -> Result<Self, String> {
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_tungstenite::connect_async(url),
        )
        .await
        .map_err(|_| "浏览器连接超时。")?
        .map_err(|_| "无法连接账号页面调试端口。")?;
        let (mut sink, mut source) = socket.split();
        let (outgoing, mut commands) = mpsc::channel::<Value>(32);
        let (frames, incoming) = mpsc::channel::<Frame>(64);
        let stopped = parent.child_token();
        let stop = stopped.clone();
        tauri::async_runtime::spawn(async move {
            let reason = loop {
                tokio::select! {
                    _ = stop.cancelled() => break "CDP 会话已取消",
                    command = commands.recv() => {
                        let Some(command) = command else { break "CDP 会话已取消" };
                        if sink.send(Message::Text(command.to_string().into())).await.is_err() { break "CDP 命令发送失败" }
                    }
                    message = source.next() => {
                        let message=match message {Some(Ok(message))=>message,Some(Err(_))=>break "CDP WebSocket 读取失败",None=>break "浏览器关闭了 CDP 连接"};
                        if message.is_close() { break "浏览器发送了 CDP 关闭消息" }
                        if let Message::Ping(bytes) = message {
                            if sink.send(Message::Pong(bytes)).await.is_err() { break "CDP 命令发送失败" }
                            continue;
                        }
                        let Ok(value) = serde_json::from_str::<Value>(message.to_text().unwrap_or("")) else { continue };
                        if frames.send(Ok(value)).await.is_err() { break "CDP 会话已取消" }
                    }
                }
            };
            let _ = frames.send(Err(reason)).await;
        });
        Ok(Self::over(outgoing, incoming, stopped))
    }
    /// Read replies/events from any transport. The transport receives command objects on
    /// `outgoing` and must finish with `Err(reason)` or by dropping its frame sender.
    pub fn over(
        outgoing: mpsc::Sender<Value>,
        mut incoming: mpsc::Receiver<Frame>,
        stopped: CancellationToken,
    ) -> Self {
        let (events_tx, events) = mpsc::channel(2048);
        let pending = Arc::new(Mutex::new(HashMap::<u64, Reply>::new()));
        let replies = pending.clone();
        let stop = stopped.clone();
        let reason = Arc::new(Mutex::new("CDP 连接结束"));
        let exit_reason = reason.clone();
        tauri::async_runtime::spawn(async move {
            let mut observed = Events::default();
            loop {
                tokio::select! {
                    _ = stop.cancelled() => { *exit_reason.lock().unwrap()="CDP 会话已取消"; break },
                    frame = incoming.recv() => {
                        let mut value = match frame {
                            Some(Ok(value)) => value,
                            Some(Err(reason)) => { *exit_reason.lock().unwrap()=reason; break }
                            None => { *exit_reason.lock().unwrap()="浏览器关闭了 CDP 连接"; break }
                        };
                        if let Some(id) = value["id"].as_u64() {
                            if let Some(reply) = replies.lock().unwrap().remove(&id) {
                                // Upstream errors can embed URLs or tokens; only fixed messages cross the boundary.
                                let result = if let Some(error) = value.get("error") { Err(protocol_error(error)) }
                                    else { Ok(value.get_mut("result").map(Value::take).unwrap_or(Value::Null)) };
                                let _ = reply.send(result);
                            }
                        } else if observed.retain(&value) {
                            // Losing a relevant transition makes authentication ambiguous.
                            // Stop on actual business-event overload, after discarding unused noise.
                            if observed.requests.len() > 2048 || events_tx.try_send(value).is_err() {
                                *exit_reason.lock().unwrap()="CDP 业务事件队列超过预算";break;
                            }
                        }
                    }
                }
            }
            stop.cancel();
            for (_, reply) in replies.lock().unwrap().drain() {
                let _ = reply.send(Err(format!(
                    "network-error:账号页面连接已结束（{}）。",
                    *exit_reason.lock().unwrap()
                )));
            }
        });
        Self {
            outgoing,
            pending,
            next: 0,
            events,
            stopped,
            reason,
        }
    }
    pub fn disconnect_reason(&self) -> String {
        self.reason.lock().unwrap().to_string()
    }
    pub async fn call(
        &mut self,
        session: Option<&str>,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        self.call_budget(session, method, params, Duration::from_secs(15))
            .await
    }
    async fn call_budget(
        &mut self,
        session: Option<&str>,
        method: &str,
        params: Value,
        budget: Duration,
    ) -> Result<Value, String> {
        if self.stopped.is_cancelled() {
            return Err(format!(
                "network-error:账号页面连接已结束（{}）。",
                self.disconnect_reason()
            ));
        }
        self.next += 1;
        let id = self.next;
        let (reply, mut wait) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, reply);
        let _pending = PendingCall {
            id,
            replies: self.pending.clone(),
        };
        let mut command = json!({"id":id,"method":method,"params":params});
        if let Some(session) = session {
            command["sessionId"] = session.into();
        }
        let answer = tokio::select! {
            // The reader may deliver a reply and observe socket closure in the same turn.
            // Consume the delivered reply first; an unfinished command still fails on closure.
            biased;
            result = tokio::time::timeout(budget, async {
                self.outgoing.send(command).await.map_err(|_| "network-error:浏览器连接已结束。".to_string())?;
                (&mut wait).await.map_err(|_| "network-error:浏览器连接已结束。".to_string())?
            }) =>
                result.map_err(|_| "request-timeout:浏览器操作超时，请重试。".to_string()).and_then(|v| v),
            // Closure can arrive on another runtime thread between polling the two branches.
            // Recheck the reply channel as well as prioritizing the response future.
            _ = self.stopped.cancelled() => wait.try_recv().unwrap_or_else(|_| Err(format!("network-error:账号页面连接已结束（{}）。", self.disconnect_reason()))),
        };
        answer.map_err(|message| {
            // Coded native errors (`limit-exceeded:` etc.) keep their product error class.
            if message.split_once(':').is_some_and(|(code, _)| {
                !code.is_empty() && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
            }) {
                message
            } else {
                format!("{method}：{message}")
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dropping_a_command_future_releases_its_reply_without_a_socket_response() {
        tauri::async_runtime::block_on(async {
            let (outgoing, mut commands) = mpsc::channel::<Value>(1);
            let (_, events) = mpsc::channel(1);
            let pending = Arc::new(Mutex::new(HashMap::<u64, Reply>::new()));
            let mut cdp = Cdp {
                outgoing,
                pending: pending.clone(),
                next: 0,
                events,
                stopped: CancellationToken::new(),
                reason: Arc::new(Mutex::new("fixture")),
            };
            {
                let mut call = Box::pin(cdp.call(None, "cancelled-search", json!({})));
                tokio::select! {
                    command = commands.recv() => assert_eq!(command.unwrap()["method"], "cancelled-search"),
                    _ = &mut call => panic!("fixture must wait for its reply"),
                }
                assert_eq!(pending.lock().unwrap().len(), 1);
            }
            assert!(pending.lock().unwrap().is_empty());
            cdp.stopped.cancel();
            assert!(cdp.call(None, "after-cancel", json!({})).await.is_err());
            assert!(commands.try_recv().is_err());
        });
    }
    #[test]
    fn delivered_reply_is_not_discarded_by_a_simultaneous_disconnect() {
        tauri::async_runtime::block_on(async {
            let (outgoing, mut commands) = mpsc::channel::<Value>(1);
            let (_, events) = mpsc::channel(1);
            let pending = Arc::new(Mutex::new(HashMap::<u64, Reply>::new()));
            let stopped = CancellationToken::new();
            let replies = pending.clone();
            let stop = stopped.clone();
            let reader = tauri::async_runtime::spawn(async move {
                let command = commands.recv().await.unwrap();
                let reply = replies
                    .lock()
                    .unwrap()
                    .remove(&command["id"].as_u64().unwrap())
                    .unwrap();
                reply.send(Ok(json!({"received":true}))).unwrap();
                // No yield between response delivery and the following socket-close notification.
                stop.cancel();
            });
            let mut cdp = Cdp {
                outgoing,
                pending,
                next: 0,
                events,
                stopped,
                reason: Arc::new(Mutex::new("浏览器关闭了 CDP 连接")),
            };
            assert_eq!(
                cdp.call(None, "fixture", json!({})).await.unwrap(),
                json!({"received":true})
            );
            reader.await.unwrap();
            assert!(cdp.pending.lock().unwrap().is_empty());
            assert!(cdp.call(None, "after-close", json!({})).await.is_err());
        });
    }
    #[test]
    fn timed_out_reply_cannot_complete_the_next_command_and_disconnect_drains_pending() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let first: Value =
                    serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap())
                        .unwrap();
                let second: Value =
                    serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap())
                        .unwrap();
                ws.send(Message::Text(
                    json!({"id":first["id"],"result":{"late":true}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                ws.send(Message::Text(
                    json!({"id":second["id"],"result":{"current":true}})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                let _ = ws.next().await;
                ws.close(None).await.unwrap();
            });
            let stop = CancellationToken::new();
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &stop)
                .await
                .unwrap();
            assert!(
                cdp.call_budget(None, "first", json!({}), Duration::from_millis(20))
                    .await
                    .is_err()
            );
            let current = cdp.call(None, "second", json!({})).await.unwrap();
            assert_eq!(current["current"], true);
            assert!(current.get("late").is_none());
            assert!(cdp.call(None, "disconnect", json!({})).await.is_err());
            assert!(cdp.pending.lock().unwrap().is_empty());
        });
    }
    #[test]
    fn interleaved_events_and_late_replies() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let cmd: Value =
                    serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap())
                        .unwrap();
                // A real detail page emits thousands of byte-progress/lifecycle events
                // while the actor awaits its response body; these must not kill the socket.
                for index in 0..4096 {
                    for value in [
                        json!({"method":"Network.dataReceived","params":{"requestId":"media","dataLength":100}}),
                        json!({"method":"Network.responseReceived","params":{"requestId":format!("script-{index}"),"type":"Script"}}),
                        json!({"method":"Network.loadingFinished","params":{"requestId":format!("script-{index}")}}),
                    ] {
                        ws.send(Message::Text(value.to_string().into()))
                            .await
                            .unwrap();
                    }
                }
                for value in [
                    json!({"method":"Network.responseReceived","params":{"requestId":"fixture","type":"Fetch"}}),
                    json!({"method":"Network.loadingFinished","params":{"requestId":"fixture"}}),
                    json!({"id":999,"result":{"ignored":true}}),
                    json!({"id":cmd["id"],"result":{"ok":true}}),
                ] {
                    ws.send(Message::Text(value.to_string().into()))
                        .await
                        .unwrap();
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            });
            let stop = CancellationToken::new();
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &stop)
                .await
                .unwrap();
            assert_eq!(
                cdp.call(None, "fixture", json!({})).await.unwrap()["ok"],
                true
            );
            assert_eq!(
                cdp.events.recv().await.unwrap()["params"]["requestId"],
                "fixture"
            );
            assert_eq!(
                cdp.events.recv().await.unwrap()["method"],
                "Network.loadingFinished"
            );
            assert!(cdp.events.try_recv().is_err());
            stop.cancel();
            assert!(cdp.call(None, "cancelled", json!({})).await.is_err());
            assert!(cdp.pending.lock().unwrap().is_empty());
        });
    }
}
