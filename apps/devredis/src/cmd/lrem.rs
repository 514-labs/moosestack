use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// LREM key count element
#[derive(Debug)]
pub struct Lrem {
    key: String,
    count: i64,
    value: bytes::Bytes,
}

impl Lrem {
    /// Parse an LREM command from the remaining frame entries.
    pub fn parse(parse: &mut Parse) -> crate::Result<Lrem> {
        let key = parse.next_string()?;
        let count = parse.next_int()?;
        let value = parse.next_bytes()?;
        parse.finish()?;
        Ok(Lrem { key, count, value })
    }

    /// Execute the LREM command, removing matching elements and writing the removed count.
    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match db.lrem(&self.key, self.count, &self.value) {
            Ok(removed) => Frame::Integer(removed),
            Err(e) => Frame::Error(e),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
