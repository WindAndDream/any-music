//! Cursor-scoped transport bytes. No DTO parsing or signed-URL replay belongs here.
use super::Packet;
use std::collections::{HashMap, HashSet};

pub(super) const MAX_BODY: usize = 12 * 1024 * 1024;
const MAX_BUFFERED: usize = 2 * MAX_BODY;
const MAX_REQUESTS: usize = 8;
const MAX_PACKETS: usize = 3;
type CachedPacket = Result<Packet, String>;

#[derive(Default)]
struct PageResponses {
    last: Option<u64>,
    unordered: bool,
    consumed: HashSet<u64>,
    requests: HashMap<String, (u64, Option<u16>)>,
    packets: HashMap<u64, CachedPacket>,
}

#[derive(Default)]
pub(super) struct ResponseCache {
    pages: HashMap<String, PageResponses>,
    buffered: usize,
}

fn size(packet: &CachedPacket) -> usize {
    packet.as_ref().map_or(0, |packet| packet.body.len())
}

impl ResponseCache {
    #[cfg(test)]
    pub fn contains(&self, listing: &str, offset: u64) -> bool {
        self.pages
            .get(listing)
            .is_some_and(|page| page.packets.contains_key(&offset))
    }
    pub fn register(&mut self, listing: &str) {
        self.pages.entry(listing.into()).or_default();
    }
    pub fn register_import(&mut self, listing: &str) {
        self.pages.entry(listing.into()).or_default().unordered = true;
    }
    pub fn request_cursor(&self, listing: &str, id: &str) -> Option<u64> {
        self.pages
            .get(listing)?
            .requests
            .get(id)
            .map(|(cursor, _)| *cursor)
    }
    pub fn consumed(&self, listing: &str, cursor: u64) -> bool {
        self.pages
            .get(listing)
            .is_some_and(|page| page.consumed.contains(&cursor))
    }

    pub fn remove(&mut self, listing: &str) {
        if let Some(page) = self.pages.remove(listing) {
            self.buffered -= page.packets.values().map(size).sum::<usize>();
        }
    }

    pub fn pending(&self, listing: &str, offset: u64) -> bool {
        self.pages
            .get(listing)
            .is_some_and(|page| page.requests.values().any(|(cursor, _)| *cursor == offset))
    }

    pub fn started(&mut self, listing: &str, id: &str, offset: u64) {
        self.track_request(listing, id, offset, None);
    }

    pub fn track(&mut self, listing: &str, id: &str, offset: u64, status: u16) {
        if (100..=599).contains(&status) {
            self.track_request(listing, id, offset, Some(status));
        }
    }

    fn track_request(&mut self, listing: &str, id: &str, offset: u64, status: Option<u16>) {
        let Some(page) = self.pages.get_mut(listing) else {
            return;
        };
        // Headers complete the existing in-flight request, even at the request cap.
        // Duplicate headers never replace its first status or initiate another read.
        if let Some((cursor, current)) = page.requests.get_mut(id) {
            if *cursor == offset && current.is_none() {
                *current = status;
            }
            return;
        }
        // A duplicate response must not replace the first packet or read its body again.
        if id.is_empty()
            || stale(page, offset)
            || page.requests.len() >= MAX_REQUESTS
            || page.requests.contains_key(id)
            || page.packets.contains_key(&offset)
            || page
                .requests
                .values()
                .any(|(pending, _)| *pending == offset)
        {
            return;
        }
        page.requests.insert(id.into(), (offset, status));
    }

    /// Remove the pending request before reading; stale/full caches need no CDP body call.
    pub fn finish(&mut self, listing: &str, id: &str) -> Option<(u64, u16)> {
        let (offset, status) = self.remove_request(listing, id)?;
        status.map(|status| (offset, status))
    }

    pub fn failed(&mut self, listing: &str, id: &str) -> Option<u64> {
        self.remove_request(listing, id).map(|(offset, _)| offset)
    }

    fn remove_request(&mut self, listing: &str, id: &str) -> Option<(u64, Option<u16>)> {
        let page = self.pages.get_mut(listing)?;
        let (offset, status) = page.requests.remove(id)?;
        (!stale(page, offset)
            && page.packets.len() < MAX_PACKETS
            && !page.packets.contains_key(&offset))
        .then_some((offset, status))
    }

    pub fn store(&mut self, listing: &str, offset: u64, packet: CachedPacket) {
        let Some(page) = self.pages.get_mut(listing) else {
            return;
        };
        if page.packets.len() >= MAX_PACKETS
            || page.packets.contains_key(&offset)
            || stale(page, offset)
        {
            return;
        }
        let bytes = size(&packet);
        let packet = if bytes > MAX_BODY || bytes > MAX_BUFFERED - self.buffered {
            Err("limit-exceeded:搜索预加载响应超过缓存预算，请重新打开列表。".into())
        } else {
            self.buffered += bytes;
            packet
        };
        page.packets.insert(offset, packet);
    }

    pub fn take(&mut self, listing: &str, offset: u64) -> Option<CachedPacket> {
        let page = self.pages.get_mut(listing)?;
        let packet = page.packets.remove(&offset)?;
        self.buffered -= size(&packet);
        if packet.is_ok() {
            if page.unordered {
                if page.consumed.len() >= 8192 {
                    return Some(Err(
                        "limit-exceeded:导入分页超过预算，请重新打开列表。".into()
                    ));
                }
                page.consumed.insert(offset);
            }
            page.last = Some(offset);
            // The consumer can skip an official preload cursor. Free older packets and
            // pending responses now so deep pagination cannot exhaust a stale cache.
            page.packets.retain(|cursor, packet| {
                if (page.unordered && !page.consumed.contains(cursor))
                    || (!page.unordered && *cursor > offset)
                {
                    true
                } else {
                    self.buffered -= size(packet);
                    false
                }
            });
            page.requests.retain(|_, (cursor, _)| {
                if page.unordered {
                    !page.consumed.contains(cursor)
                } else {
                    *cursor > offset
                }
            });
        }
        Some(packet)
    }
}

fn stale(page: &PageResponses, cursor: u64) -> bool {
    if page.unordered {
        page.consumed.contains(&cursor)
    } else {
        page.last.is_some_and(|last| cursor <= last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(bytes: usize) -> CachedPacket {
        Ok(Packet {
            status: 200,
            body: vec![0; bytes],
        })
    }

    #[test]
    fn import_cursors_can_decrease_without_serving_a_consumed_page_again() {
        let mut cache = ResponseCache::default();
        cache.register_import("likes");
        for cursor in [0, 1723456789123, 1723456789000] {
            cache.started("likes", "request", cursor);
            assert_eq!(cache.request_cursor("likes", "request"), Some(cursor));
            cache.track("likes", "request", cursor, 200);
            assert_eq!(cache.finish("likes", "request"), Some((cursor, 200)));
            cache.store("likes", cursor, packet(8));
            assert_eq!(cache.take("likes", cursor).unwrap().unwrap().body.len(), 8);
            assert!(cache.consumed("likes", cursor));
            cache.track("likes", "duplicate", cursor, 200);
            assert!(cache.finish("likes", "duplicate").is_none());
        }
        cache.remove("likes");
        assert_eq!(cache.buffered, 0);
    }

    #[test]
    fn requests_pause_scrolling_before_headers_and_release_on_completion_or_failure() {
        let mut cache = ResponseCache::default();
        cache.register("a");
        cache.started("a", "first", 10);
        cache.started("a", "duplicate", 10);
        assert!(cache.pending("a", 10));
        assert!(!cache.pending("a", 20));
        assert!(!cache.pending("b", 10));
        assert!(cache.finish("a", "duplicate").is_none());
        cache.track("a", "first", 10, 200);
        cache.track("a", "first", 10, 429);
        assert_eq!(cache.finish("a", "first"), Some((10, 200)));
        assert!(!cache.pending("a", 10));
        cache.started("a", "failed-before-headers", 20);
        assert_eq!(cache.failed("a", "failed-before-headers"), Some(20));
        assert!(!cache.pending("a", 20));
        cache.started("a", "no-status", 30);
        assert!(cache.finish("a", "no-status").is_none());
        assert!(!cache.pending("a", 30));
    }

    #[test]
    fn duplicates_skipped_cursors_and_closed_listings_release_the_budget() {
        let mut cache = ResponseCache::default();
        cache.register("a");
        cache.register("b");
        cache.track("a", "first", 0, 200);
        cache.track("a", "duplicate", 0, 200);
        assert!(cache.finish("a", "duplicate").is_none());
        assert_eq!(cache.finish("a", "first"), Some((0, 200)));
        cache.store("a", 0, packet(4));
        cache.track("a", "late", 0, 200);
        assert!(cache.finish("a", "late").is_none());
        cache.store("a", 10, packet(8));
        cache.track("a", "stale", 5, 200);
        cache.store("b", 0, packet(16));
        assert_eq!(cache.buffered, 28);
        assert_eq!(cache.take("a", 10).unwrap().unwrap().body.len(), 8);
        assert!(cache.take("a", 0).is_none());
        assert!(cache.finish("a", "stale").is_none());
        assert_eq!(cache.buffered, 16);
        cache.remove("b");
        assert_eq!(cache.buffered, 0);
        cache.store("b", 10, packet(4));
        assert_eq!(cache.buffered, 0);
    }

    #[test]
    fn global_bytes_and_per_listing_requests_and_packets_are_bounded() {
        let mut cache = ResponseCache::default();
        for id in ["a", "b", "c"] {
            cache.register(id);
        }
        cache.store("a", 0, packet(MAX_BODY));
        cache.store("b", 0, packet(MAX_BODY));
        cache.store("c", 0, packet(1));
        assert_eq!(cache.buffered, MAX_BUFFERED);
        assert!(
            cache
                .take("c", 0)
                .unwrap()
                .unwrap_err()
                .starts_with("limit-exceeded:")
        );
        cache.remove("a");
        cache.store("c", 10, packet(MAX_BODY));
        assert_eq!(cache.buffered, MAX_BUFFERED);
        cache.remove("b");
        cache.remove("c");
        assert_eq!(cache.buffered, 0);
        cache.register("c");
        for offset in 0..10 {
            cache.track("c", &offset.to_string(), offset, 200);
        }
        assert_eq!(cache.pages["c"].requests.len(), MAX_REQUESTS);
        for offset in 0..MAX_PACKETS as u64 {
            cache.store("c", offset, packet(1));
        }
        assert!(cache.finish("c", "4").is_none());
        cache.remove("c");
        assert_eq!(cache.buffered, 0);
    }
}
