use crate::frame::Frame;
use bytes::Bytes;
use std::vec;

/// Utility for parsing a command from a Frame::Array.
///
/// Provides sequential access to elements in the array, with typed extraction
/// methods.
pub struct Parse {
    parts: vec::IntoIter<Frame>,
}

/// Error returned when parsing fails.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct ParseError {
    message: String,
}

impl Parse {
    /// Create a new `Parse` from a Frame, which must be an Array.
    pub fn new(frame: Frame) -> Result<Parse, ParseError> {
        match frame {
            Frame::Array(parts) => Ok(Parse {
                parts: parts.into_iter(),
            }),
            frame => Err(ParseError {
                message: format!("protocol error; expected array, got {:?}", frame),
            }),
        }
    }

    /// Return the next entry. An array frame is a sequence of entries.
    fn next(&mut self) -> Result<Frame, ParseError> {
        self.parts.next().ok_or(ParseError {
            message: "protocol error; unexpected end of frame".into(),
        })
    }

    /// Return the next entry as a string.
    ///
    /// Handles both Bulk and Simple strings.
    pub fn next_string(&mut self) -> Result<String, ParseError> {
        match self.next()? {
            Frame::Simple(s) => Ok(s),
            Frame::Bulk(data) => std::str::from_utf8(&data[..])
                .map(|s| s.to_string())
                .map_err(|_| ParseError {
                    message: "protocol error; invalid string".into(),
                }),
            frame => Err(ParseError {
                message: format!(
                    "protocol error; expected simple or bulk string, got {:?}",
                    frame
                ),
            }),
        }
    }

    /// Return the next entry as raw bytes.
    pub fn next_bytes(&mut self) -> Result<Bytes, ParseError> {
        match self.next()? {
            Frame::Simple(s) => Ok(Bytes::from(s)),
            Frame::Bulk(data) => Ok(data),
            frame => Err(ParseError {
                message: format!(
                    "protocol error; expected simple or bulk string, got {:?}",
                    frame
                ),
            }),
        }
    }

    /// Return the next entry as an integer.
    pub fn next_int(&mut self) -> Result<i64, ParseError> {
        match self.next()? {
            Frame::Integer(n) => Ok(n),
            Frame::Bulk(data) => {
                let s = std::str::from_utf8(&data[..]).map_err(|_| ParseError {
                    message: "protocol error; invalid integer encoding".into(),
                })?;
                s.parse().map_err(|_| ParseError {
                    message: "protocol error; invalid integer".into(),
                })
            }
            Frame::Simple(s) => s.parse().map_err(|_| ParseError {
                message: "protocol error; invalid integer".into(),
            }),
            frame => Err(ParseError {
                message: format!(
                    "protocol error; expected integer, bulk, or simple string, got {:?}",
                    frame
                ),
            }),
        }
    }

    /// Ensure there are no more entries in the array.
    pub fn finish(&mut self) -> Result<(), ParseError> {
        if self.parts.next().is_none() {
            Ok(())
        } else {
            Err(ParseError {
                message: "protocol error; expected end of frame, but there was more".into(),
            })
        }
    }

    /// Return remaining count of entries.
    pub fn remaining(&self) -> usize {
        self.parts.len()
    }
}

impl From<String> for ParseError {
    fn from(src: String) -> ParseError {
        ParseError { message: src }
    }
}

impl From<&str> for ParseError {
    fn from(src: &str) -> ParseError {
        ParseError {
            message: src.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cmd(parts: Vec<Frame>) -> Parse {
        Parse::new(Frame::Array(parts)).unwrap()
    }

    #[test]
    fn test_new_rejects_non_array() {
        assert!(Parse::new(Frame::Simple("hello".into())).is_err());
        assert!(Parse::new(Frame::Integer(1)).is_err());
    }

    #[test]
    fn test_next_string_simple_and_bulk() {
        let mut p = make_cmd(vec![
            Frame::Simple("hello".into()),
            Frame::Bulk(Bytes::from("world")),
        ]);
        assert_eq!(p.next_string().unwrap(), "hello");
        assert_eq!(p.next_string().unwrap(), "world");
    }

    #[test]
    fn test_next_string_end_of_frame() {
        let mut p = make_cmd(vec![]);
        assert!(p.next_string().is_err());
    }

    #[test]
    fn test_next_bytes() {
        let mut p = make_cmd(vec![Frame::Bulk(Bytes::from("data"))]);
        assert_eq!(p.next_bytes().unwrap(), Bytes::from("data"));
    }

    #[test]
    fn test_next_int_from_integer_and_bulk() {
        let mut p = make_cmd(vec![
            Frame::Integer(42),
            Frame::Bulk(Bytes::from("99")),
            Frame::Simple("7".into()),
        ]);
        assert_eq!(p.next_int().unwrap(), 42);
        assert_eq!(p.next_int().unwrap(), 99);
        assert_eq!(p.next_int().unwrap(), 7);
    }

    #[test]
    fn test_next_int_invalid() {
        let mut p = make_cmd(vec![Frame::Bulk(Bytes::from("notanum"))]);
        assert!(p.next_int().is_err());
    }

    #[test]
    fn test_finish_ok_when_empty() {
        let mut p = make_cmd(vec![]);
        assert!(p.finish().is_ok());
    }

    #[test]
    fn test_finish_err_when_remaining() {
        let mut p = make_cmd(vec![Frame::Simple("a".into()), Frame::Simple("b".into())]);
        p.next_string().unwrap(); // consume first
        assert!(p.finish().is_err()); // "b" still remains
    }

    #[test]
    fn test_remaining() {
        let mut p = make_cmd(vec![Frame::Integer(1), Frame::Integer(2)]);
        assert_eq!(p.remaining(), 2);
        p.next_int().unwrap();
        assert_eq!(p.remaining(), 1);
    }
}
