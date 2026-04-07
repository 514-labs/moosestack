use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::lua;
use crate::parse::Parse;

/// EVALSHA sha1 numkeys [key ...] [arg ...]
///
/// Looks up a previously-loaded script by SHA1 and executes it. If the script
/// has not been loaded (via SCRIPT LOAD), returns NOSCRIPT — the `redis` crate
/// then sends SCRIPT LOAD + retries EVALSHA, which succeeds on the second attempt.
#[derive(Debug)]
pub struct Evalsha {
    sha1: String,
    keys: Vec<String>,
    args: Vec<bytes::Bytes>,
}

impl Evalsha {
    pub fn parse(parse: &mut Parse) -> crate::Result<Evalsha> {
        let sha1 = parse.next_string()?;
        let numkeys = parse.next_int()?;
        if numkeys < 0 {
            return Err("ERR Number of keys can't be negative".into());
        }

        let mut keys = Vec::with_capacity(numkeys as usize);
        for _ in 0..numkeys {
            keys.push(parse.next_string()?);
        }

        let mut args = Vec::new();
        while parse.remaining() > 0 {
            args.push(parse.next_bytes()?);
        }

        Ok(Evalsha { sha1, keys, args })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let script = match db.script_get(&self.sha1) {
            Some(code) => code,
            None => {
                dst.write_frame(&Frame::Error(
                    "NOSCRIPT No matching script. Please use EVAL.".to_string(),
                ))
                .await?;
                return Ok(());
            }
        };

        // Execute the script the same way EVAL does.
        let response = {
            let mut state = db.lock_state();
            match lua::eval_script(&script, self.keys, self.args, &mut state) {
                Ok(frame) => frame,
                Err(e) => Frame::Error(format!("ERR {}", e)),
            }
        };
        db.notify_expiry();

        dst.write_frame(&response).await?;
        Ok(())
    }
}
