use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// EXPIRE key seconds
#[derive(Debug)]
pub struct Expire {
    key: String,
    seconds: i64,
}

impl Expire {
    /// Parse an EXPIRE command. Rejects non-positive TTLs.
    pub fn parse(parse: &mut Parse) -> crate::Result<Expire> {
        let key = parse.next_string()?;
        let seconds = parse.next_int()?;
        if seconds <= 0 {
            return Err("ERR invalid expire time in 'EXPIRE' command".into());
        }
        parse.finish()?;
        Ok(Expire { key, seconds })
    }

    /// Execute the EXPIRE command, returning 1 if the key exists, 0 otherwise.
    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let result = if db.expire(&self.key, self.seconds) {
            1
        } else {
            0
        };
        let response = Frame::Integer(result);
        dst.write_frame(&response).await?;
        Ok(())
    }
}
