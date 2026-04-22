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
    /// Parse a `SCRIPT` command and its subcommand-specific arguments.
    pub fn parse(parse: &mut Parse) -> crate::Result<Script> {
        let subcommand = parse.next_string()?.to_uppercase();
        match subcommand.as_str() {
            "LOAD" => {
                let code = parse.next_string()?;
                parse.finish()?;
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
                if parse.remaining() > 1 {
                    return Err("ERR wrong number of arguments for 'SCRIPT FLUSH' command".into());
                }
                if parse.remaining() == 1 {
                    let mode = parse.next_string()?.to_uppercase();
                    if mode != "ASYNC" && mode != "SYNC" {
                        return Err("ERR syntax error".into());
                    }
                }
                Ok(Script::Flush)
            }
            _ => Err(format!("ERR Unknown SCRIPT subcommand '{subcommand}'").into()),
        }
    }

    /// Execute a parsed `SCRIPT` command and write the RESP reply.
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

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;
    use crate::frame::Frame;

    fn parse_script(parts: &[&str]) -> crate::Result<Script> {
        let mut parse = Parse::new(Frame::Array(
            parts
                .iter()
                .map(|part| Frame::Bulk(Bytes::from((*part).to_string())))
                .collect(),
        ))
        .unwrap();
        let _ = parse.next_string().unwrap();
        Script::parse(&mut parse)
    }

    #[test]
    fn script_load_rejects_extra_args() {
        let err = parse_script(&["SCRIPT", "LOAD", "return 1", "extra"]).unwrap_err();
        assert_eq!(
            err.to_string(),
            "protocol error; expected end of frame, but there was more"
        );
    }

    #[test]
    fn script_flush_rejects_extra_args() {
        let err = parse_script(&["SCRIPT", "FLUSH", "SYNC", "extra"]).unwrap_err();
        assert_eq!(
            err.to_string(),
            "ERR wrong number of arguments for 'SCRIPT FLUSH' command"
        );
    }

    #[test]
    fn script_flush_rejects_invalid_mode() {
        let err = parse_script(&["SCRIPT", "FLUSH", "LATER"]).unwrap_err();
        assert_eq!(err.to_string(), "ERR syntax error");
    }
}
