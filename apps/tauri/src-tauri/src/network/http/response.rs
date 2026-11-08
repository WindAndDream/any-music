//! Ordinary HTTP's raw IPC frame; independent of the browser verification response DTO.
use serde::Serialize;

const MAX_METADATA_BYTES: usize = 1024 * 1024;

pub(super) struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: String,
    pub body: Vec<u8>,
    pub is_binary: bool,
}

impl HttpResponse {
    /// Four-byte big-endian metadata length, JSON metadata, then unchanged body bytes.
    pub fn into_ipc(self) -> Result<tauri::ipc::Response, String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Metadata<'a> {
            status: u16,
            status_text: &'a str,
            headers: &'a str,
            response_type: &'a str,
        }
        let metadata = serde_json::to_vec(&Metadata {
            status: self.status,
            status_text: &self.status_text,
            headers: &self.headers,
            response_type: if self.is_binary { "bytes" } else { "text" },
        })
        .map_err(|_| "invalid-response:无法编码原生响应元数据。")?;
        if metadata.len() > MAX_METADATA_BYTES {
            return Err("limit-exceeded:原生响应元数据超过预算。".into());
        }
        let mut frame = Vec::with_capacity(4 + metadata.len() + self.body.len());
        frame.extend_from_slice(&(metadata.len() as u32).to_be_bytes());
        frame.extend(metadata);
        frame.extend(self.body);
        Ok(tauri::ipc::Response::new(frame))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    fn raw(response: HttpResponse) -> Vec<u8> {
        let InvokeResponseBody::Raw(bytes) = response.into_ipc().unwrap().body().unwrap() else {
            panic!("HTTP bodies must not expand into JSON arrays");
        };
        bytes
    }

    fn hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn binary_frame_matches_the_renderer_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../test/fixtures/native-http-response.json"
        ))
        .unwrap();
        let bytes = raw(HttpResponse {
            status: fixture["metadata"]["status"].as_u64().unwrap() as u16,
            status_text: fixture["metadata"]["statusText"].as_str().unwrap().into(),
            headers: fixture["metadata"]["headers"].as_str().unwrap().into(),
            body: hex(fixture["bodyHex"].as_str().unwrap()),
            is_binary: true,
        });
        assert_eq!(bytes, hex(fixture["frameHex"].as_str().unwrap()));
    }

    #[test]
    fn large_binary_body_has_only_fixed_metadata_overhead() {
        let bytes = raw(HttpResponse {
            status: 200,
            status_text: "OK".into(),
            headers: String::new(),
            body: vec![255; 1024 * 1024],
            is_binary: true,
        });
        let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
        assert!(length < 256);
        assert_eq!(bytes.len(), 4 + length + 1024 * 1024);
        assert!(bytes[4 + length..].iter().all(|byte| *byte == 255));
    }

    #[test]
    fn oversized_metadata_is_rejected_before_delivery() {
        let result = HttpResponse {
            status: 200,
            status_text: "OK".into(),
            headers: "x".repeat(MAX_METADATA_BYTES),
            body: Vec::new(),
            is_binary: false,
        }
        .into_ipc();
        assert!(result.err().unwrap().starts_with("limit-exceeded:"));
    }
}
