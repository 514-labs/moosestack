use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// RPUSH key element [element ...]
pub struct Rpush {
    key: String,
    values: Vec<bytes::Bytes>,
}

impl Rpush {
    pub fn parse(parse: &mut Parse) -> crate::Result<Rpush> {
        let key = parse.next_string()?;
        let mut values = vec![parse.next_bytes()?];
        while parse.remaining() > 0 {
            values.push(parse.next_bytes()?);
        }
        Ok(Rpush { key, values })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match db.rpush(self.key, self.values) {
            Ok(len) => Frame::Integer(len),
            Err(e) => Frame::Error(e),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
