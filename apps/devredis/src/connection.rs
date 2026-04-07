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
    /// Reusable buffer for serializing outgoing frames.
    write_buf: Vec<u8>,
    /// When set, `write_frame` pushes to this vec instead of writing to the
    /// socket.  Used by EXEC to capture per-command responses.
    captured: Option<Vec<Frame>>,
}

impl Connection {
    /// Create a new `Connection` backed by `socket`.
    pub fn new(socket: TcpStream) -> Connection {
        Connection {
            stream: BufWriter::new(socket),
            buffer: BytesMut::with_capacity(4 * 1024),
            write_buf: Vec::with_capacity(1024),
            captured: None,
        }
    }

    /// Start capturing frames written via `write_frame`.
    pub fn start_capture(&mut self) {
        self.captured = Some(Vec::new());
    }

    /// Stop capturing and return the collected frames.
    pub fn stop_capture(&mut self) -> Vec<Frame> {
        self.captured.take().unwrap_or_default()
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
    ///
    /// If capture mode is active (via [`start_capture`]), the frame is stored
    /// in memory instead of being written to the socket.
    pub async fn write_frame(&mut self, frame: &Frame) -> io::Result<()> {
        if let Some(ref mut captured) = self.captured {
            captured.push(frame.clone());
            return Ok(());
        }
        self.write_buf.clear();
        frame.write_to(&mut self.write_buf);
        self.stream.write_all(&self.write_buf).await?;
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
