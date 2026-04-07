use std::time::Duration;

use bytes::Bytes;

use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// SET key value [EX seconds | PX milliseconds] [NX | XX] [GET]
/// Also handles SETEX key seconds value (different arg order).
#[derive(Debug)]
pub struct Set {
    key: String,
    value: Bytes,
    expire: Option<Duration>,
    /// When true, return the old value (SET … GET).
    get: bool,
    /// NX: only set if key does not exist.
    nx: bool,
    /// XX: only set if key already exists.
    xx: bool,
}

impl Set {
    /// Parse a SET command: SET key value [EX seconds] [PX milliseconds] [NX|XX] [GET]
    pub fn parse_set(parse: &mut Parse) -> crate::Result<Set> {
        let key = parse.next_string()?;
        let value = parse.next_bytes()?;

        let mut expire = None;
        let mut get = false;
        let mut nx = false;
        let mut xx = false;

        while parse.remaining() > 0 {
            let opt = parse.next_string()?.to_uppercase();
            match opt.as_str() {
                "EX" => {
                    let secs = parse.next_int()?;
                    if secs <= 0 {
                        return Err("ERR invalid expire time in 'SET' command".into());
                    }
                    expire = Some(Duration::from_secs(secs as u64));
                }
                "PX" => {
                    let ms = parse.next_int()?;
                    if ms <= 0 {
                        return Err("ERR invalid expire time in 'SET' command".into());
                    }
                    expire = Some(Duration::from_millis(ms as u64));
                }
                "NX" => nx = true,
                "XX" => xx = true,
                "GET" => get = true,
                "KEEPTTL" => {} // Acknowledged but not implemented — ignore silently.
                other => {
                    return Err(format!("ERR Unsupported SET option '{}'", other).into());
                }
            }
        }

        Ok(Set {
            key,
            value,
            expire,
            get,
            nx,
            xx,
        })
    }

    /// Parse a SETEX command: SETEX key seconds value
    pub fn parse_setex(parse: &mut Parse) -> crate::Result<Set> {
        let key = parse.next_string()?;
        let secs = parse.next_int()?;
        if secs <= 0 {
            return Err("ERR invalid expire time in 'SETEX' command".into());
        }
        let value = parse.next_bytes()?;
        parse.finish()?;

        Ok(Set {
            key,
            value,
            expire: Some(Duration::from_secs(secs as u64)),
            get: false,
            nx: false,
            xx: false,
        })
    }

    /// Execute the SET/SETEX command, storing the value and replying with OK.
    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        // Fetch old value when GET is requested, or to check NX/XX conditions.
        let old_value = if self.get || self.nx || self.xx {
            db.get(&self.key).ok().flatten()
        } else {
            None
        };

        let key_exists = old_value.is_some();

        // NX: only set when key does NOT exist.
        // XX: only set when key DOES exist.
        let should_set = (!self.nx || !key_exists) && (!self.xx || key_exists);

        if should_set {
            db.set(self.key, self.value, self.expire);
        }

        let response = if self.get {
            // GET: return the old value (or Null if it didn't exist).
            match old_value {
                Some(v) => Frame::Bulk(v),
                None => Frame::NullBulk,
            }
        } else if should_set {
            Frame::Simple("OK".to_string())
        } else {
            // NX/XX condition not met, no GET — return Null.
            Frame::NullBulk
        };

        dst.write_frame(&response).await?;
        Ok(())
    }
}
