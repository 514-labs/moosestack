use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// PUBLISH channel message
pub struct Publish {
    channel: String,
    message: bytes::Bytes,
}

impl Publish {
    pub fn parse(parse: &mut Parse) -> crate::Result<Publish> {
        let channel = parse.next_string()?;
        let message = parse.next_bytes()?;
        parse.finish()?;
        Ok(Publish { channel, message })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let count = db.publish(&self.channel, self.message);
        let response = Frame::Integer(count);
        dst.write_frame(&response).await?;
        Ok(())
    }
}
