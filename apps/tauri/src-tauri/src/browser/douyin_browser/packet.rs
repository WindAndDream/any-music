//! Native response bytes shared by profile reads, search capture and fresh work detail.
use serde_json::Value;

#[derive(Debug)]
pub(crate) struct Packet {
    pub status: u16,
    pub body: Vec<u8>,
}
impl Packet {
    pub fn from_value(mut value: Value) -> Result<Self, String> {
        Ok(Self {
            status: value["status"].as_u64().unwrap_or(200) as u16,
            body: serde_json::from_value(value["body"].take())
                .map_err(|_| "invalid-response:账号资料响应格式不兼容。".to_string())?,
        })
    }
    /// Preserve the two-byte status prefix and raw body without JSON array expansion.
    pub fn into_ipc(self) -> tauri::ipc::Response {
        let mut bytes = Vec::with_capacity(self.body.len() + 2);
        bytes.extend_from_slice(&self.status.to_be_bytes());
        bytes.extend(self.body);
        tauri::ipc::Response::new(bytes)
    }
}
