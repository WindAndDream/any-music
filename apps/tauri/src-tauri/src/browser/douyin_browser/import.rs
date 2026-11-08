//! Official import routes and request identity, without music DTO parsing or signed-URL replay.
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Target {
    History,
    Favorites,
    CollectedVideos,
    CollectedMixes,
    Mix(String),
}

impl Target {
    pub fn new(kind: &str, mix_id: Option<String>) -> Result<Self, String> {
        match (kind, mix_id) {
            ("self-history", None) => Ok(Self::History),
            ("self-favorites", None) => Ok(Self::Favorites),
            ("self-collected-videos", None) => Ok(Self::CollectedVideos),
            ("self-collected-mixes", None) => Ok(Self::CollectedMixes),
            ("mix", Some(id))
                if !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_digit()) =>
            {
                Ok(Self::Mix(id))
            }
            _ => Err("invalid-input:抖音导入类型或合集标识无效。".into()),
        }
    }

    pub fn url(&self) -> String {
        match self {
            Self::History => "https://www.douyin.com/user/self?showTab=record".into(),
            Self::Favorites => "https://www.douyin.com/user/self?showSubTab=video&showTab=like".into(),
            Self::CollectedVideos => "https://www.douyin.com/user/self?showSubTab=video&showTab=favorite_collection".into(),
            Self::CollectedMixes => "https://www.douyin.com/user/self?showSubTab=compilation&showTab=favorite_collection".into(),
            Self::Mix(id) => format!("https://www.douyin.com/collection/{id}/1"),
        }
    }

    pub fn matches_response(&self, params: &Value) -> bool {
        self.endpoint(params["type"].as_str(), params["response"]["url"].as_str())
            .is_some()
    }

    fn endpoint(&self, resource_type: Option<&str>, url: Option<&str>) -> Option<reqwest::Url> {
        if !matches!(resource_type, Some("XHR" | "Fetch")) {
            return None;
        }
        let url = url?.parse::<reqwest::Url>().ok()?;
        if url.scheme() != "https"
            || !matches!(url.host_str(), Some("www.douyin.com" | "www-hj.douyin.com"))
            || url.port_or_known_default() != Some(443)
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        let path = match self {
            Self::History => "/aweme/v1/web/history/read/",
            Self::Favorites => "/aweme/v1/web/aweme/favorite/",
            Self::CollectedVideos => "/aweme/v1/web/aweme/listcollection/",
            Self::CollectedMixes => "/aweme/v1/web/mix/listcollection/",
            Self::Mix(_) => "/aweme/v1/web/mix/aweme/",
        };
        (url.path() == path).then_some(url)
    }

    pub fn request_cursor(&self, params: &Value) -> Option<u64> {
        let url = self.endpoint(params["type"].as_str(), params["request"]["url"].as_str())?;
        let method = params["request"]["method"].as_str()?;
        let values: Vec<_> = if matches!(self, Self::CollectedVideos) {
            if method != "POST" {
                return None;
            }
            // Collection cursor belongs to the form body, never to a guessed response cursor.
            if url.query_pairs().any(|(key, _)| key == "cursor") {
                return None;
            }
            reqwest::Url::parse(&format!(
                "https://form.invalid/?{}",
                params["request"]["postData"].as_str()?
            ))
            .ok()?
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
        } else {
            if method != "GET" {
                return None;
            }
            url.query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect()
        };
        let unique = |key: &str| {
            let mut entries = values.iter().filter(|(k, _)| k == key);
            let (_, value) = entries.next()?;
            entries.next().is_none().then_some(value.as_str())
        };
        if let Self::Mix(id) = self
            && unique("mix_id")? != id
        {
            return None;
        }
        if matches!(self, Self::Favorites) && unique("sec_user_id")?.is_empty() {
            return None;
        }
        let cursor = unique(if matches!(self, Self::Favorites | Self::History) {
            "max_cursor"
        } else {
            "cursor"
        })?;
        if cursor.is_empty() || !cursor.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        cursor
            .parse::<u64>()
            .ok()
            .filter(|cursor| *cursor <= 9_007_199_254_740_991)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn routes_and_cursors_keep_likes_collections_and_mixes_separate() {
        for (kind, mix, method, path, query, body, cursor) in [
            (
                "self-history",
                None,
                "GET",
                "history/read",
                "max_cursor=1723456789123&count=20",
                "",
                1723456789123,
            ),
            (
                "self-favorites",
                None,
                "GET",
                "aweme/favorite",
                "sec_user_id=self&max_cursor=1723456789123",
                "",
                1723456789123,
            ),
            (
                "self-collected-videos",
                None,
                "POST",
                "aweme/listcollection",
                "",
                "cursor=18&count=18",
                18,
            ),
            (
                "self-collected-mixes",
                None,
                "GET",
                "mix/listcollection",
                "cursor=10",
                "",
                10,
            ),
            (
                "mix",
                Some("123".into()),
                "GET",
                "mix/aweme",
                "mix_id=123&cursor=20",
                "",
                20,
            ),
        ] {
            let target = Target::new(kind, mix).unwrap();
            let url = format!("https://www-hj.douyin.com/aweme/v1/web/{path}/?{query}");
            let params =
                json!({"type":"Fetch","request":{"url":url,"method":method,"postData":body}});
            assert_eq!(target.request_cursor(&params), Some(cursor));
            assert_eq!(
                target.request_cursor(&json!({"type":"Document","request":params["request"]})),
                None
            );
            let mut wrong = params.clone();
            wrong["request"]["url"] = url.replace("www-hj.douyin.com", "evil.invalid").into();
            assert_eq!(target.request_cursor(&wrong), None);
            wrong = params.clone();
            wrong["request"]["method"] = "PUT".into();
            assert_eq!(target.request_cursor(&wrong), None);
            if method == "POST" {
                wrong = params.clone();
                wrong["request"]["postData"] = "cursor=18&cursor=19".into();
            } else {
                wrong = params.clone();
                wrong["request"]["url"] = format!(
                    "{url}&{}={cursor}",
                    if matches!(kind, "self-favorites" | "self-history") {
                        "max_cursor"
                    } else {
                        "cursor"
                    }
                )
                .into();
            }
            assert_eq!(target.request_cursor(&wrong), None);
        }
        assert!(Target::new("mix", Some("../user/self".into())).is_err());
        assert!(Target::new("self-favorites", Some("123".into())).is_err());
        assert!(Target::new("self-history", Some("123".into())).is_err());
        assert!(Target::new("unknown", None).is_err());
    }
}
