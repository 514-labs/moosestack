use crate::connection::Connection;
use crate::frame::Frame;
use crate::parse::Parse;

/// PING [message]
pub struct Ping {
    msg: Option<String>,
}

impl Ping {
    pub fn parse(parse: &mut Parse) -> crate::Result<Ping> {
        let msg = parse.next_string().ok();
        Ok(Ping { msg })
    }

    pub async fn apply(self, dst: &mut Connection) -> crate::Result<()> {
        let response = match self.msg {
            Some(msg) => Frame::Bulk(msg.into()),
            None => Frame::Simple("PONG".to_string()),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
