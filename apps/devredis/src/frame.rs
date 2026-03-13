use bytes::Buf;
use std::fmt;
use std::io::Cursor;
use std::num::TryFromIntError;
use std::string::FromUtf8Error;

/// A RESP2 frame.
#[derive(Clone, Debug)]
pub enum Frame {
    Simple(String),
    Error(String),
    Integer(i64),
    Bulk(bytes::Bytes),
    Null,
    Array(Vec<Frame>),
}

#[derive(Debug)]
pub enum Error {
    /// Not enough data to parse a complete frame.
    Incomplete,
    /// Invalid frame data.
    Other(crate::Error),
}

impl Frame {
    /// Check if an entire frame can be decoded from `src`.
    ///
    /// This does not consume the data; it only checks completeness.
    pub fn check(src: &mut Cursor<&[u8]>) -> Result<(), Error> {
        match get_u8(src)? {
            b'+' => {
                get_line(src)?;
                Ok(())
            }
            b'-' => {
                get_line(src)?;
                Ok(())
            }
            b':' => {
                get_line(src)?;
                Ok(())
            }
            b'$' => {
                let len = get_decimal(src)?;
                if len == -1 {
                    // Null bulk string
                    Ok(())
                } else {
                    let len = usize::try_from(len)
                        .map_err(|_| Error::Other("invalid bulk string length".into()))?;
                    // len bytes + \r\n
                    skip(src, len + 2)?;
                    Ok(())
                }
            }
            b'*' => {
                let len = get_decimal(src)?;
                if len == -1 {
                    // Null array
                    Ok(())
                } else {
                    let len = usize::try_from(len)
                        .map_err(|_| Error::Other("invalid array length".into()))?;
                    for _ in 0..len {
                        Frame::check(src)?;
                    }
                    Ok(())
                }
            }
            actual => Err(Error::Other(
                format!("protocol error; invalid frame type byte `{}`", actual).into(),
            )),
        }
    }

    /// Parse a frame from `src`, consuming the data.
    pub fn parse(src: &mut Cursor<&[u8]>) -> Result<Frame, Error> {
        match get_u8(src)? {
            b'+' => {
                let line = get_line(src)?.to_vec();
                let string = String::from_utf8(line)?;
                Ok(Frame::Simple(string))
            }
            b'-' => {
                let line = get_line(src)?.to_vec();
                let string = String::from_utf8(line)?;
                Ok(Frame::Error(string))
            }
            b':' => {
                let n = get_decimal(src)?;
                Ok(Frame::Integer(n))
            }
            b'$' => {
                let len = get_decimal(src)?;
                if len == -1 {
                    Ok(Frame::Null)
                } else {
                    let len = usize::try_from(len)
                        .map_err(|_| Error::Other("invalid bulk string length".into()))?;
                    if src.remaining() < len + 2 {
                        return Err(Error::Incomplete);
                    }
                    let data = bytes::Bytes::copy_from_slice(&src.chunk()[..len]);
                    skip(src, len + 2)?;
                    Ok(Frame::Bulk(data))
                }
            }
            b'*' => {
                let len = get_decimal(src)?;
                if len == -1 {
                    Ok(Frame::Null)
                } else {
                    let len = usize::try_from(len)
                        .map_err(|_| Error::Other("invalid array length".into()))?;
                    let mut out = Vec::with_capacity(len);
                    for _ in 0..len {
                        out.push(Frame::parse(src)?);
                    }
                    Ok(Frame::Array(out))
                }
            }
            _ => unreachable!(),
        }
    }

    /// Write this frame to a buffer in RESP2 wire format.
    pub fn write_to(&self, dst: &mut Vec<u8>) {
        match self {
            Frame::Simple(val) => {
                dst.push(b'+');
                dst.extend_from_slice(val.as_bytes());
                dst.extend_from_slice(b"\r\n");
            }
            Frame::Error(val) => {
                dst.push(b'-');
                dst.extend_from_slice(val.as_bytes());
                dst.extend_from_slice(b"\r\n");
            }
            Frame::Integer(val) => {
                dst.push(b':');
                dst.extend_from_slice(val.to_string().as_bytes());
                dst.extend_from_slice(b"\r\n");
            }
            Frame::Bulk(val) => {
                dst.push(b'$');
                dst.extend_from_slice(val.len().to_string().as_bytes());
                dst.extend_from_slice(b"\r\n");
                dst.extend_from_slice(val);
                dst.extend_from_slice(b"\r\n");
            }
            Frame::Null => {
                dst.extend_from_slice(b"$-1\r\n");
            }
            Frame::Array(val) => {
                dst.push(b'*');
                dst.extend_from_slice(val.len().to_string().as_bytes());
                dst.extend_from_slice(b"\r\n");
                for frame in val {
                    frame.write_to(dst);
                }
            }
        }
    }
}

impl fmt::Display for Frame {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Frame::Simple(s) => write!(f, "+{}", s),
            Frame::Error(s) => write!(f, "-{}", s),
            Frame::Integer(n) => write!(f, ":{}", n),
            Frame::Bulk(b) => match std::str::from_utf8(b) {
                Ok(s) => write!(f, "${}", s),
                Err(_) => write!(f, "${:?}", b),
            },
            Frame::Null => write!(f, "$-1"),
            Frame::Array(a) => {
                write!(f, "*{}", a.len())?;
                for frame in a {
                    write!(f, " {}", frame)?;
                }
                Ok(())
            }
        }
    }
}

fn get_u8(src: &mut Cursor<&[u8]>) -> Result<u8, Error> {
    if !src.has_remaining() {
        return Err(Error::Incomplete);
    }
    Ok(src.get_u8())
}

fn skip(src: &mut Cursor<&[u8]>, n: usize) -> Result<(), Error> {
    if src.remaining() < n {
        return Err(Error::Incomplete);
    }
    src.advance(n);
    Ok(())
}

/// Read a line terminated by \r\n, returning the bytes without the terminator.
fn get_line<'a>(src: &mut Cursor<&'a [u8]>) -> Result<&'a [u8], Error> {
    let start = src.position() as usize;
    let end = src.get_ref().len() - 1;

    for i in start..end {
        if src.get_ref()[i] == b'\r' && src.get_ref()[i + 1] == b'\n' {
            src.set_position((i + 2) as u64);
            return Ok(&src.get_ref()[start..i]);
        }
    }

    Err(Error::Incomplete)
}

/// Parse a decimal integer from a line.
fn get_decimal(src: &mut Cursor<&[u8]>) -> Result<i64, Error> {
    let line = get_line(src)?;
    let s = std::str::from_utf8(line).map_err(|e| Error::Other(e.to_string().into()))?;
    let n: i64 = s
        .parse()
        .map_err(|e: std::num::ParseIntError| Error::Other(e.to_string().into()))?;
    Ok(n)
}

impl From<String> for Error {
    fn from(src: String) -> Error {
        Error::Other(src.into())
    }
}

impl From<&str> for Error {
    fn from(src: &str) -> Error {
        src.to_string().into()
    }
}

impl From<FromUtf8Error> for Error {
    fn from(src: FromUtf8Error) -> Error {
        Error::Other(src.to_string().into())
    }
}

impl From<TryFromIntError> for Error {
    fn from(src: TryFromIntError) -> Error {
        Error::Other(src.to_string().into())
    }
}

impl std::error::Error for Error {}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Incomplete => write!(f, "stream ended early"),
            Error::Other(err) => write!(f, "{}", err),
        }
    }
}
