use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// LPOP key
pub struct Lpop {
    key: String,
}

impl Lpop {
    pub fn parse(parse: &mut Parse) -> crate::Result<Lpop> {
        let key = parse.next_string()?;
        parse.finish()?;
        Ok(Lpop { key })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match db.lpop(&self.key) {
            Ok(Some(val)) => Frame::Bulk(val),
            Ok(None) => Frame::Null,
            Err(e) => Frame::Error(e),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
