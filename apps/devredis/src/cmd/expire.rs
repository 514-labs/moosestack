use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// EXPIRE key seconds
pub struct Expire {
    key: String,
    seconds: i64,
}

impl Expire {
    pub fn parse(parse: &mut Parse) -> crate::Result<Expire> {
        let key = parse.next_string()?;
        let seconds = parse.next_int()?;
        parse.finish()?;
        Ok(Expire { key, seconds })
    }

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
