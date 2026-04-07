use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// RPOPLPUSH source destination
pub struct Rpoplpush {
    source: String,
    destination: String,
}

impl Rpoplpush {
    pub fn parse(parse: &mut Parse) -> crate::Result<Rpoplpush> {
        let source = parse.next_string()?;
        let destination = parse.next_string()?;
        parse.finish()?;
        Ok(Rpoplpush {
            source,
            destination,
        })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match db.rpoplpush(&self.source, &self.destination) {
            Ok(Some(val)) => Frame::Bulk(val),
            Ok(None) => Frame::Null,
            Err(e) => Frame::Error(e),
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
