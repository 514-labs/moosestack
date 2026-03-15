use crate::frame::Frame;
use bytes::Bytes;
use std::fmt;
use std::vec;

/// Utility for parsing a command from a Frame::Array.
///
/// Provides sequential access to elements in the array, with typed extraction
/// methods.
pub struct Parse {
    parts: vec::IntoIter<Frame>,
}

/// Error returned when parsing fails.
#[derive(Debug)]
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
                    "protocol error; expected integer or bulk string, got {:?}",
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

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ParseError {}

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
