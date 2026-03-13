use crate::frame::{self, Frame};

use bytes::{Buf, BytesMut};
use std::io::{self, Cursor};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::net::TcpStream;

/// Send and receive `Frame` values from a remote peer.
///
/// Uses an internal buffer to batch reads and writes for efficiency.
pub struct Connection {
    stream: BufWriter<TcpStream>,
    buffer: BytesMut,
}

impl Connection {
    /// Create a new `Connection` backed by `socket`.
    pub fn new(socket: TcpStream) -> Connection {
        Connection {
            stream: BufWriter::new(socket),
            buffer: BytesMut::with_capacity(4 * 1024),
        }
    }

    /// Read a single `Frame` value from the underlying stream.
    ///
    /// Returns `None` if the peer closed the connection cleanly (EOF).
    pub async fn read_frame(&mut self) -> crate::Result<Option<Frame>> {
        loop {
            // Attempt to parse a frame from the buffered data.
            if let Some(frame) = self.parse_frame()? {
                return Ok(Some(frame));
            }

            // Read more data from the socket.
            let n = self.stream.read_buf(&mut self.buffer).await?;
            if n == 0 {
                // The remote closed the connection.
                if self.buffer.is_empty() {
                    return Ok(None);
                } else {
                    return Err("connection reset by peer".into());
                }
            }
        }
    }

    /// Write a single `Frame` value to the underlying stream.
    pub async fn write_frame(&mut self, frame: &Frame) -> io::Result<()> {
        let mut buf = Vec::new();
        frame.write_to(&mut buf);
        self.stream.write_all(&buf).await?;
        self.stream.flush().await?;
        Ok(())
    }

    /// Try to parse a frame from the buffer. Returns Ok(None) if more data is
    /// needed.
    fn parse_frame(&mut self) -> crate::Result<Option<Frame>> {
        use frame::Error::Incomplete;

        let mut cursor = Cursor::new(&self.buffer[..]);

        match Frame::check(&mut cursor) {
            Ok(()) => {
                // The `check` function advanced the cursor to the end of the
                // frame. We use that position to extract the frame bytes.
                let len = cursor.position() as usize;

                // Reset the cursor for parsing.
                cursor.set_position(0);

                let frame = Frame::parse(&mut cursor)?;

                // Discard the parsed data from the read buffer.
                self.buffer.advance(len);

                Ok(Some(frame))
            }
            Err(Incomplete) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}
