use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// GET key
pub struct Get {
    key: String,
}

impl Get {
    pub fn parse(parse: &mut Parse) -> crate::Result<Get> {
        let key = parse.next_string()?;
        parse.finish()?;
        Ok(Get { key })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match db.get(&self.key) {
            Some(value) => Frame::Bulk(value),
            None => Frame::Null,
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
