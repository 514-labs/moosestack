use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// KEYS pattern
#[derive(Debug)]
pub struct Keys {
    pattern: String,
}

impl Keys {
    /// Parse a KEYS command from the remaining frame entries.
    pub fn parse(parse: &mut Parse) -> crate::Result<Keys> {
        let pattern = parse.next_string()?;
        parse.finish()?;
        Ok(Keys { pattern })
    }

    /// Execute the KEYS command, returning all keys matching the glob pattern.
    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let keys = db.keys(&self.pattern);
        let response = Frame::Array(keys.into_iter().map(|k| Frame::Bulk(k.into())).collect());
        dst.write_frame(&response).await?;
        Ok(())
    }
}
