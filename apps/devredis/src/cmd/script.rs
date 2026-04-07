use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;

/// SCRIPT subcommand variants supported by devredis.
#[derive(Debug)]
pub enum Script {
    Load(String),
    Exists(Vec<String>),
    Flush,
}

impl Script {
    pub fn parse(parse: &mut Parse) -> crate::Result<Script> {
        let subcommand = parse.next_string()?.to_uppercase();
        match subcommand.as_str() {
            "LOAD" => {
                let code = parse.next_string()?;
                Ok(Script::Load(code))
            }
            "EXISTS" => {
                let mut hashes = Vec::new();
                while parse.remaining() > 0 {
                    hashes.push(parse.next_string()?);
                }
                Ok(Script::Exists(hashes))
            }
            "FLUSH" => {
                // Consume optional ASYNC/SYNC argument.
                while parse.remaining() > 0 {
                    let _ = parse.next_string()?;
                }
                Ok(Script::Flush)
            }
            _ => Err(format!("ERR Unknown SCRIPT subcommand '{subcommand}'").into()),
        }
    }

    pub async fn apply(self, db: &Db, dst: &mut Connection) -> crate::Result<()> {
        let response = match self {
            Script::Load(code) => {
                let hash = db.script_load(&code);
                Frame::Bulk(hash.into())
            }
            Script::Exists(hashes) => {
                let results = db.script_exists(&hashes);
                let frames = results
                    .into_iter()
                    .map(|exists| Frame::Integer(if exists { 1 } else { 0 }))
                    .collect();
                Frame::Array(frames)
            }
            Script::Flush => {
                db.script_flush();
                Frame::Simple("OK".to_string())
            }
        };
        dst.write_frame(&response).await?;
        Ok(())
    }
}
