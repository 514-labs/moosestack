use std::time::Duration;

use bytes::Bytes;

use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// SET key value [EX seconds | PX milliseconds]
/// Also handles SETEX key seconds value (different arg order).
pub struct Set {
    key: String,
    value: Bytes,
    expire: Option<Duration>,
}

impl Set {
    /// Parse a SET command: SET key value [EX seconds] [PX milliseconds]
    pub fn parse_set(parse: &mut Parse) -> crate::Result<Set> {
        let key = parse.next_string()?;
        let value = parse.next_bytes()?;

        let mut expire = None;

        // Parse optional EX/PX.
        while parse.remaining() > 0 {
            let opt = parse.next_string()?.to_uppercase();
            match opt.as_str() {
                "EX" => {
                    let secs = parse.next_int()?;
                    expire = Some(Duration::from_secs(secs as u64));
                }
                "PX" => {
                    let ms = parse.next_int()?;
                    expire = Some(Duration::from_millis(ms as u64));
                }
                _ => {
                    // Ignore unknown options for forward compat.
                }
            }
        }

        Ok(Set { key, value, expire })
    }

    /// Parse a SETEX command: SETEX key seconds value
    pub fn parse_setex(parse: &mut Parse) -> crate::Result<Set> {
        let key = parse.next_string()?;
        let secs = parse.next_int()?;
        let value = parse.next_bytes()?;
        parse.finish()?;

        Ok(Set {
            key,
            value,
            expire: Some(Duration::from_secs(secs as u64)),
        })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        db.set(self.key, self.value, self.expire);
        let response = Frame::Simple("OK".to_string());
        dst.write_frame(&response).await?;
        Ok(())
    }
}
