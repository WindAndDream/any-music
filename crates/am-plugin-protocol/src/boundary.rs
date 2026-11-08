use crate::{
    LIMIT_DEPTH, LIMIT_MESSAGE_BYTES, LIMIT_NODES, LIMIT_STRING_CODE_POINTS, ProtocolError,
};
use serde_json::{Map, Value};

/// Parse before map construction so escaped duplicate keys cannot be silently overwritten.
pub(crate) fn parse(bytes: &[u8]) -> Result<Value, ProtocolError> {
    if bytes.len() > LIMIT_MESSAGE_BYTES || std::str::from_utf8(bytes).is_err() {
        return Err(ProtocolError);
    }
    let mut parser = Parser {
        bytes,
        offset: 0,
        nodes: 0,
    };
    let value = parser.value(0)?;
    parser.whitespace();
    if parser.offset != bytes.len() {
        return Err(ProtocolError);
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    offset: usize,
    nodes: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.offset).copied()
    }
    fn whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.offset += 1;
        }
    }
    fn count(&mut self) -> Result<(), ProtocolError> {
        self.nodes += 1;
        if self.nodes > LIMIT_NODES {
            Err(ProtocolError)
        } else {
            Ok(())
        }
    }
    fn string(&mut self) -> Result<String, ProtocolError> {
        if self.peek() != Some(b'"') {
            return Err(ProtocolError);
        }
        let start = self.offset;
        self.offset += 1;
        while let Some(byte) = self.peek() {
            self.offset += 1;
            if byte == b'\\' {
                if self.peek().is_none() {
                    return Err(ProtocolError);
                }
                self.offset += 1;
            } else if byte == b'"' {
                let text: String = serde_json::from_slice(&self.bytes[start..self.offset])
                    .map_err(|_| ProtocolError)?;
                if text.chars().count() > LIMIT_STRING_CODE_POINTS {
                    return Err(ProtocolError);
                }
                return Ok(text);
            }
        }
        Err(ProtocolError)
    }
    fn value(&mut self, depth: usize) -> Result<Value, ProtocolError> {
        if depth > LIMIT_DEPTH {
            return Err(ProtocolError);
        }
        self.count()?;
        self.whitespace();
        match self.peek() {
            Some(b'"') => self.string().map(Value::String),
            Some(b'{') => {
                self.offset += 1;
                self.whitespace();
                let mut object = Map::new();
                if self.peek() == Some(b'}') {
                    self.offset += 1;
                    return Ok(Value::Object(object));
                }
                loop {
                    self.whitespace();
                    let key = self.string()?;
                    self.count()?;
                    if ["__proto__", "prototype", "constructor"].contains(&key.as_str())
                        || object.contains_key(&key)
                    {
                        return Err(ProtocolError);
                    }
                    self.whitespace();
                    if self.peek() != Some(b':') {
                        return Err(ProtocolError);
                    }
                    self.offset += 1;
                    object.insert(key, self.value(depth + 1)?);
                    self.whitespace();
                    match self.peek() {
                        Some(b'}') => {
                            self.offset += 1;
                            break;
                        }
                        Some(b',') => self.offset += 1,
                        _ => return Err(ProtocolError),
                    }
                }
                Ok(Value::Object(object))
            }
            Some(b'[') => {
                self.offset += 1;
                self.whitespace();
                let mut array = Vec::new();
                if self.peek() == Some(b']') {
                    self.offset += 1;
                    return Ok(Value::Array(array));
                }
                loop {
                    array.push(self.value(depth + 1)?);
                    self.whitespace();
                    match self.peek() {
                        Some(b']') => {
                            self.offset += 1;
                            break;
                        }
                        Some(b',') => self.offset += 1,
                        _ => return Err(ProtocolError),
                    }
                }
                Ok(Value::Array(array))
            }
            Some(b't' | b'f' | b'n') => {
                for (word, value) in [
                    (b"true".as_slice(), Value::Bool(true)),
                    (b"false".as_slice(), Value::Bool(false)),
                    (b"null".as_slice(), Value::Null),
                ] {
                    if self.bytes[self.offset..].starts_with(word) {
                        self.offset += word.len();
                        return Ok(value);
                    }
                }
                Err(ProtocolError)
            }
            Some(b'-' | b'0'..=b'9') => {
                let start = self.offset;
                if self.peek() == Some(b'-') {
                    self.offset += 1;
                }
                if self.peek() == Some(b'0') {
                    self.offset += 1;
                } else {
                    if !matches!(self.peek(), Some(b'1'..=b'9')) {
                        return Err(ProtocolError);
                    }
                    while matches!(self.peek(), Some(b'0'..=b'9')) {
                        self.offset += 1;
                    }
                }
                let token = &self.bytes[start..self.offset];
                let number = std::str::from_utf8(token)
                    .map_err(|_| ProtocolError)?
                    .parse::<i64>()
                    .map_err(|_| ProtocolError)?;
                if token == b"-0"
                    || !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&number)
                {
                    return Err(ProtocolError);
                }
                Ok(Value::from(number))
            }
            _ => Err(ProtocolError),
        }
    }
}
