use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::lua;
use crate::parse::Parse;

/// EVAL script numkeys [key ...] [arg ...]
pub struct Eval {
    script: String,
    keys: Vec<String>,
    args: Vec<bytes::Bytes>,
}

impl Eval {
    pub fn parse(parse: &mut Parse) -> crate::Result<Eval> {
        let script = parse.next_string()?;
        let numkeys = parse.next_int()?;

        let mut keys = Vec::with_capacity(numkeys as usize);
        for _ in 0..numkeys {
            keys.push(parse.next_string()?);
        }

        let mut args = Vec::new();
        while parse.remaining() > 0 {
            args.push(parse.next_bytes()?);
        }

        Ok(Eval { script, keys, args })
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        // Hold the db lock for the entire Lua execution (atomicity).
        // Compute response synchronously, then drop lock before awaiting write.
        let response = {
            let mut state = db.lock_state();
            match lua::eval_script(&self.script, self.keys, self.args, &mut state) {
                Ok(frame) => frame,
                Err(e) => Frame::Error(format!("ERR {}", e)),
            }
        };

        dst.write_frame(&response).await?;
        Ok(())
    }
}
