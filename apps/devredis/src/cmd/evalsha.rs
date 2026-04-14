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
    fn noscript_error_frame() -> Frame {
        Frame::Error("NOSCRIPT No matching script. Please use EVAL.".to_string())
    }

    /// Parse an `EVALSHA` command from a RESP array.
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

    /// Execute a previously-loaded Lua script by SHA1 and write the RESP reply.
    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let script = match db.script_get(&self.sha1) {
            Some(code) => code,
            None => {
                dst.write_frame(&Self::noscript_error_frame()).await?;
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

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;
    use crate::frame::Frame;

    fn parse_evalsha(parts: &[&str]) -> crate::Result<Evalsha> {
        let mut parse = Parse::new(Frame::Array(
            parts
                .iter()
                .map(|part| Frame::Bulk(Bytes::from((*part).to_string())))
                .collect(),
        ))
        .unwrap();
        let _ = parse.next_string().unwrap();
        Evalsha::parse(&mut parse)
    }

    #[test]
    fn evalsha_rejects_negative_numkeys() {
        let err = parse_evalsha(&["EVALSHA", "deadbeef", "-1"]).unwrap_err();
        assert_eq!(err.to_string(), "ERR Number of keys can't be negative");
    }

    #[test]
    fn evalsha_parses_keys_and_args() {
        let parsed = parse_evalsha(&["EVALSHA", "deadbeef", "2", "k1", "k2", "arg1"]).unwrap();
        assert_eq!(parsed.sha1, "deadbeef");
        assert_eq!(parsed.keys, vec!["k1".to_string(), "k2".to_string()]);
        assert_eq!(parsed.args, vec![Bytes::from("arg1")]);
    }

    #[test]
    fn evalsha_noscript_error_frame_matches_redis_shape() {
        assert!(matches!(
            Evalsha::noscript_error_frame(),
            Frame::Error(message) if message == "NOSCRIPT No matching script. Please use EVAL."
        ));
    }
}
