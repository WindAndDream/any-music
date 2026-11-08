//! Two bounded tree indexes provide logarithmic range lookup and LRU promotion without scans.
use super::{ENTRY_OVERHEAD, Piece, now};
use std::collections::BTreeMap;

struct Entry {
    piece: Piece,
    touched: u64,
    expires: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(total: u64) -> Piece {
        Piece {
            bytes: vec![1, 2, 3, 4],
            offset: 0,
            total,
            mime: "audio/mp4".into(),
        }
    }

    #[test]
    fn bounds_memory_promotes_hits_and_owns_returned_bytes() {
        let mut cache = MemoryCache::default();
        cache.configure(2 * (ENTRY_OVERHEAD + 4));
        let expires = now() + 60;
        cache.put("a", &piece(4), expires);
        cache.put("b", &piece(4), expires);
        cache.read("a", 0).unwrap().bytes[0] = 99;
        cache.put("c", &piece(4), expires);
        assert!(cache.read("b", 0).is_none());
        assert_eq!(cache.read("a", 0).unwrap().bytes[0], 1);
        assert_eq!(cache.count(), 2);
        assert!(cache.used <= cache.capacity);
        cache.configure(ENTRY_OVERHEAD + 4);
        assert_eq!(cache.count(), 1);
        cache.configure(0);
        assert_eq!(cache.used, 0);
        assert_eq!(cache.count(), 0);
    }

    #[test]
    fn rejects_expired_bytes_and_invalidates_an_oversized_new_representation() {
        let mut cache = MemoryCache::default();
        cache.configure(ENTRY_OVERHEAD + 4);
        cache.put("a", &piece(4), now() + 60);
        let mut replacement = piece(5);
        replacement.bytes.push(5);
        cache.put("a", &replacement, now() + 60);
        assert!(cache.read("a", 0).is_none());
        cache.put("a", &piece(4), now() - 1);
        assert_eq!(cache.used, 0);
        cache.put("a", &piece(4), now() + 60);
        cache
            .entries
            .get_mut("a")
            .unwrap()
            .get_mut(&0)
            .unwrap()
            .expires = now() - 1;
        assert!(cache.read("a", 0).is_none());
        assert_eq!(cache.used, 0);
    }
}
#[derive(Default)]
pub(super) struct MemoryCache {
    entries: BTreeMap<String, BTreeMap<u64, Entry>>,
    lru: BTreeMap<u64, (String, u64)>,
    pub capacity: u64,
    pub used: u64,
    sequence: u64,
}
impl MemoryCache {
    pub fn count(&self) -> u64 {
        self.lru.len() as u64
    }
    pub fn configure(&mut self, capacity: u64) {
        self.capacity = capacity;
        self.trim(0);
    }
    pub fn clear(&mut self) {
        self.entries.clear();
        self.lru.clear();
        self.used = 0;
    }
    pub fn invalidate(&mut self, key: &str) {
        if let Some(pieces) = self.entries.remove(key) {
            for entry in pieces.into_values() {
                self.used -= entry.piece.bytes.len() as u64 + ENTRY_OVERHEAD;
                self.lru.remove(&entry.touched);
            }
        }
    }
    fn remove(&mut self, key: &str, offset: u64) {
        let Some(pieces) = self.entries.get_mut(key) else {
            return;
        };
        if let Some(entry) = pieces.remove(&offset) {
            self.used -= entry.piece.bytes.len() as u64 + ENTRY_OVERHEAD;
            self.lru.remove(&entry.touched);
        }
        if pieces.is_empty() {
            self.entries.remove(key);
        }
    }
    fn trim(&mut self, extra: u64) {
        while self.used + extra > self.capacity || self.lru.len() > 4096 {
            let Some((_, (key, offset))) = self.lru.first_key_value() else {
                break;
            };
            let key = key.clone();
            let offset = *offset;
            self.remove(&key, offset);
        }
    }
    pub fn read(&mut self, key: &str, offset: u64) -> Option<Piece> {
        let entry = self.entries.get(key)?.range(..=offset).next_back()?.1;
        let start = entry.piece.offset;
        if entry.expires <= now() {
            self.remove(key, start);
            return None;
        }
        // An overlapping short fragment may hide a longer one; miss to the indexed disk query.
        if start + entry.piece.bytes.len() as u64 <= offset {
            return None;
        }
        let touched = entry.touched;
        let piece = entry.piece.clone();
        self.lru.remove(&touched);
        self.sequence += 1;
        self.lru.insert(self.sequence, (key.into(), start));
        self.entries.get_mut(key)?.get_mut(&start)?.touched = self.sequence;
        Some(piece)
    }
    pub fn put(&mut self, key: &str, piece: &Piece, expires: u64) {
        let charge = piece.bytes.len() as u64 + ENTRY_OVERHEAD;
        if self
            .entries
            .get(key)
            .and_then(|pieces| pieces.first_key_value())
            .is_some_and(|(_, entry)| entry.piece.total != piece.total)
        {
            self.invalidate(key);
        }
        if charge > self.capacity || expires <= now() {
            return;
        }
        self.remove(key, piece.offset);
        self.trim(charge);
        self.sequence += 1;
        self.entries.entry(key.into()).or_default().insert(
            piece.offset,
            Entry {
                piece: piece.clone(),
                touched: self.sequence,
                expires,
            },
        );
        self.lru.insert(self.sequence, (key.into(), piece.offset));
        self.used += charge;
        self.trim(0);
    }
}
