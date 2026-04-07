use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// DEL key [key ...]
/// Also accepts DELETE (Python redis client sends this).
pub struct Del {
    keys: Vec<String>,
}

impl Del {
    pub fn parse(parse: &mut Parse) -> crate::Result<Del> {
        let mut keys = vec![parse.next_string()?];
        while parse.remaining() > 0 {
            keys.push(parse.next_string()?);
        }
        Ok(Del { keys })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let count = db.del(&self.keys);
        let response = Frame::Integer(count);
        dst.write_frame(&response).await?;
        Ok(())
    }
}
