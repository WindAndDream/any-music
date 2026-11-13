use crate::{Error, Target};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Sandbox,
    Declarative,
    Image,
    Media,
    Download,
    ExternalLink,
    Export,
    HostWrite,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    Public,
    Hosts(Vec<String>),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Direct,
    HttpProxy,
    SocksProxy,
    SystemProxy,
}

/// Not a wire authority DTO: the trusted adapter chooses the exit, route and budget.
pub struct Request {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub exit: Exit,
    pub route: Route,
    pub max_bytes: usize,
}
impl Request {
    pub fn get(url: String, exit: Exit) -> Self {
        Self {
            url,
            method: "GET".into(),
            headers: vec![],
            body: vec![],
            exit,
            route: Route::Direct,
            max_bytes: 4 * 1024 * 1024,
        }
    }
    pub(crate) fn validate(&self) -> Result<HeaderMap, Error> {
        if self.route != Route::Direct {
            return Err(Error::Unsupported);
        }
        if matches!(
            self.exit,
            Exit::ExternalLink | Exit::Export | Exit::HostWrite
        ) {
            // These exits require a separate native host preview/commit, never an HTTP surrogate.
            return Err(Error::Unsupported);
        }
        if !["GET", "HEAD", "POST"].contains(&self.method.as_str())
            || self.body.len() > 1024 * 1024
            || self.max_bytes == 0
            || self.max_bytes > 64 * 1024 * 1024
            || self.method != "POST" && !self.body.is_empty()
            || self.exit != Exit::Sandbox && self.method == "POST"
        {
            return Err(Error::Budget);
        }
        if matches!(self.exit, Exit::Sandbox | Exit::Declarative)
            && self.max_bytes > 4 * 1024 * 1024
        {
            return Err(Error::Budget);
        }
        let mut headers = HeaderMap::new();
        let mut size = 0usize;
        for (name, value) in &self.headers {
            size = size
                .saturating_add(name.len())
                .saturating_add(value.len() + 4);
            let key = name.to_ascii_lowercase();
            let allowed = matches!(
                key.as_str(),
                "accept"
                    | "accept-language"
                    | "content-type"
                    | "referer"
                    | "origin"
                    | "user-agent"
                    | "range"
                    | "if-range"
            ) || key.starts_with("x-")
                && !["x-forwarded-", "x-proxy-", "x-real-"]
                    .iter()
                    .any(|p| key.starts_with(p));
            if !allowed || size > 16 * 1024 || value.bytes().any(|b| b < 32 || b == 127) {
                return Err(Error::Headers);
            }
            if key == "range"
                && (!matches!(self.exit, Exit::Media | Exit::Download)
                    || !valid_range(value, self.max_bytes))
            {
                return Err(Error::Headers);
            }
            if key == "if-range" && !matches!(self.exit, Exit::Media | Exit::Download) {
                return Err(Error::Headers);
            }
            if key == "referer" || key == "origin" {
                Target::parse(value, &Scope::Public)?;
            }
            let key = HeaderName::from_bytes(key.as_bytes()).map_err(|_| Error::Headers)?;
            if headers.contains_key(&key) {
                return Err(Error::Headers);
            }
            headers.insert(
                key,
                HeaderValue::from_str(value).map_err(|_| Error::Headers)?,
            );
        }
        // Explicit identity encoding prevents feature unification enabling decompression bombs.
        headers.insert("accept-encoding", HeaderValue::from_static("identity"));
        Ok(headers)
    }
}
fn valid_range(value: &str, max: usize) -> bool {
    value
        .strip_prefix("bytes=")
        .and_then(|s| s.split_once('-'))
        .is_some_and(|(a, b)| {
            let (Ok(a), Ok(b)) = (a.parse::<u64>(), b.parse::<u64>()) else {
                return false;
            };
            a <= b
                && b.checked_sub(a)
                    .and_then(|n| n.checked_add(1))
                    .is_some_and(|n| n <= max as u64)
        })
}
