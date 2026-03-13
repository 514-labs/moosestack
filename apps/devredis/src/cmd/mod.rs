mod del;
mod eval;
mod expire;
mod get;
mod keys;
mod lpop;
mod lrem;
mod ping;
mod publish;
mod quit;
mod rpoplpush;
mod rpush;
mod set;
mod subscribe;

use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;
use crate::shutdown::Shutdown;

/// Enumeration of supported Redis commands.
pub enum Command {
    Ping(ping::Ping),
    Quit,
    Get(get::Get),
    Set(set::Set),
    Del(del::Del),
    Expire(expire::Expire),
    Keys(keys::Keys),
    Rpush(rpush::Rpush),
    Rpoplpush(rpoplpush::Rpoplpush),
    Lrem(lrem::Lrem),
    Lpop(lpop::Lpop),
    Publish(publish::Publish),
    Subscribe(subscribe::Subscribe),
    Eval(eval::Eval),
}

impl Command {
    /// Parse a command from a received frame.
    pub fn from_frame(frame: Frame) -> crate::Result<Command> {
        let mut parse = Parse::new(frame)?;

        let command_name = parse.next_string()?.to_uppercase();

        let command = match command_name.as_str() {
            "PING" => Command::Ping(ping::Ping::parse(&mut parse)?),
            "QUIT" => {
                parse.finish()?;
                Command::Quit
            }
            "GET" => Command::Get(get::Get::parse(&mut parse)?),
            "SET" => Command::Set(set::Set::parse_set(&mut parse)?),
            "SETEX" => Command::Set(set::Set::parse_setex(&mut parse)?),
            "DEL" | "DELETE" => Command::Del(del::Del::parse(&mut parse)?),
            "EXPIRE" => Command::Expire(expire::Expire::parse(&mut parse)?),
            "KEYS" => Command::Keys(keys::Keys::parse(&mut parse)?),
            "RPUSH" => Command::Rpush(rpush::Rpush::parse(&mut parse)?),
            "RPOPLPUSH" => Command::Rpoplpush(rpoplpush::Rpoplpush::parse(&mut parse)?),
            "LREM" => Command::Lrem(lrem::Lrem::parse(&mut parse)?),
            "LPOP" => Command::Lpop(lpop::Lpop::parse(&mut parse)?),
            "PUBLISH" => Command::Publish(publish::Publish::parse(&mut parse)?),
            "SUBSCRIBE" => Command::Subscribe(subscribe::Subscribe::parse(&mut parse)?),
            "EVAL" => Command::Eval(eval::Eval::parse(&mut parse)?),
            _ => {
                return Err(format!("ERR unknown command '{}'", command_name).into());
            }
        };

        Ok(command)
    }

    /// Apply the command, writing the response to `dst`.
    ///
    /// Returns `true` if the connection should be closed (QUIT command).
    pub async fn apply(
        self,
        db: &Db,
        dst: &mut Connection,
        shutdown: &mut Shutdown,
    ) -> crate::Result<bool> {
        match self {
            Command::Ping(cmd) => {
                cmd.apply(dst).await?;
                Ok(false)
            }
            Command::Quit => {
                let response = Frame::Simple("OK".to_string());
                dst.write_frame(&response).await?;
                Ok(true)
            }
            Command::Get(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Set(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Del(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Expire(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Keys(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Rpush(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Rpoplpush(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Lrem(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Lpop(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Publish(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
            Command::Subscribe(cmd) => {
                cmd.apply(db, dst, shutdown).await?;
                Ok(false)
            }
            Command::Eval(cmd) => {
                cmd.apply(db, dst).await?;
                Ok(false)
            }
        }
    }
}

// ParseError implements std::error::Error, so it automatically converts
// to Box<dyn Error + Send + Sync> via the blanket impl.
