use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// GET key
#[derive(Debug)]
pub struct Get {
    key: String,
}

impl Get {
    /// Parse a GET command from the remaining frame entries.
    pub fn parse(parse: &mut Parse) -> crate::Result<Get> {
        let key = parse.next_string()?;
        parse.finish()?;
        Ok(Get { key })
    }

    /// Execute the GET command. Returns WRONGTYPE error if key holds a non-string value.
    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match db.get(&self.key) {
            Ok(Some(value)) => Frame::Bulk(value),
            Ok(None) => Frame::NullBulk,
            Err(e) => Frame::Error(e),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
