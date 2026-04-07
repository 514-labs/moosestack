use crate::connection::Connection;
use crate::frame::Frame;
use crate::parse::Parse;

/// PING [message]
#[derive(Debug)]
pub struct Ping {
    msg: Option<String>,
}

impl Ping {
    /// Parse a PING command, optionally reading a message argument.
    pub fn parse(parse: &mut Parse) -> crate::Result<Ping> {
        let msg = if parse.remaining() > 0 {
            Some(parse.next_string()?)
        } else {
            None
        };
        Ok(Ping { msg })
    }

    /// Execute the PING command, replying with PONG or echoing the message.
    pub async fn apply(self, dst: &mut Connection) -> crate::Result<()> {
        let response = match self.msg {
            Some(msg) => Frame::Bulk(msg.into()),
            None => Frame::Simple("PONG".to_string()),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
