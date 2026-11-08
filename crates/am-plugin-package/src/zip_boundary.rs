use crate::{Error, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, paths};
use std::collections::BTreeSet;
pub(crate) struct Entry {
    pub path: String,
    pub compressed: usize,
    pub size: usize,
}
fn number(bytes: &[u8], offset: usize, count: usize) -> Result<usize, Error> {
    let field = bytes
        .get(offset..offset.checked_add(count).ok_or(Error::Archive)?)
        .ok_or(Error::Archive)?;
    Ok(field
        .iter()
        .enumerate()
        .fold(0, |n, (i, b)| n | (*b as usize) << (8 * i)))
}
fn signature(bytes: &[u8], offset: usize, value: &[u8]) -> bool {
    bytes.get(offset..offset + 4) == Some(value)
}

/// v1 deliberately excludes ZIP64, descriptors, extras, comments, directories and prefixes.
/// This bounded framing pass prevents parser differentials and metadata allocation bombs.
pub(crate) fn validate(bytes: &[u8]) -> Result<Vec<Entry>, Error> {
    let end = bytes.len().checked_sub(22).ok_or(Error::Archive)?;
    if !signature(bytes, end, b"PK\x05\x06")
        || number(bytes, end + 4, 4)? != 0
        || number(bytes, end + 20, 2)? != 0
    {
        return Err(Error::Archive);
    }
    let count = number(bytes, end + 10, 2)?;
    if count == 0 || count > MAX_FILES {
        return Err(Error::Budget);
    }
    if number(bytes, end + 8, 2)? != count {
        return Err(Error::Archive);
    }
    let mut offset = number(bytes, end + 16, 4)?;
    let central = offset;
    if central.checked_add(number(bytes, end + 12, 4)?) != Some(end) {
        return Err(Error::Archive);
    }
    let mut entries = Vec::new();
    let mut seen = BTreeSet::new();
    let mut total = 0usize;
    let mut local_end = 0usize;
    for _ in 0..count {
        if !signature(bytes, offset, b"PK\x01\x02") {
            return Err(Error::Archive);
        }
        let flags = number(bytes, offset + 8, 2)?;
        let method = number(bytes, offset + 10, 2)?;
        let compressed = number(bytes, offset + 20, 4)?;
        let size = number(bytes, offset + 24, 4)?;
        let name_len = number(bytes, offset + 28, 2)?;
        let mode = number(bytes, offset + 38, 4)?;
        let local = number(bytes, offset + 42, 4)?;
        if flags & !0x800 != 0
            || !matches!(method, 0 | 8)
            || number(bytes, offset + 30, 6)? != 0
            || mode & 0x10 != 0
            || (mode >> 16) & 0o111 != 0
            || !matches!((mode >> 16) & 0o170000, 0 | 0o100000)
            || local != local_end
        {
            return Err(Error::Archive);
        }
        if name_len > 240 {
            return Err(Error::Path);
        }
        let name = bytes
            .get(offset + 46..offset + 46 + name_len)
            .ok_or(Error::Archive)?;
        let path = std::str::from_utf8(name).map_err(|_| Error::Path)?;
        if !seen.insert(paths::validate(path)?) {
            return Err(Error::Path);
        }
        if !paths::allowed(path) {
            return Err(Error::Resource);
        }
        if size > MAX_FILE_BYTES || size > compressed.saturating_mul(100) {
            return Err(Error::Budget);
        }
        total = total.checked_add(size).ok_or(Error::Budget)?;
        if total > MAX_TOTAL_BYTES {
            return Err(Error::Budget);
        }
        if !signature(bytes, local, b"PK\x03\x04")
            || bytes.get(local + 6..local + 10) != bytes.get(offset + 8..offset + 12)
            || bytes.get(local + 14..local + 26) != bytes.get(offset + 16..offset + 28)
            || number(bytes, local + 26, 2)? != name_len
            || number(bytes, local + 28, 2)? != 0
            || bytes.get(local + 30..local + 30 + name_len) != Some(name)
        {
            return Err(Error::Archive);
        }
        local_end = local
            .checked_add(30 + name_len)
            .and_then(|n| n.checked_add(compressed))
            .ok_or(Error::Archive)?;
        if local_end > central {
            return Err(Error::Archive);
        }
        entries.push(Entry {
            path: path.into(),
            compressed,
            size,
        });
        offset += 46 + name_len;
    }
    if offset != end || local_end != central {
        return Err(Error::Archive);
    }
    Ok(entries)
}
