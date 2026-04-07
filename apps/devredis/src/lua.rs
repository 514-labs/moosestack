use bytes::Bytes;
use mlua::prelude::*;
use std::cell::RefCell;
use std::sync::MutexGuard;
use std::time::Duration;

use crate::db::{State, Value};
use crate::frame::Frame;

/// Execute a Lua EVAL script atomically against the database state.
///
/// Creates a fresh Lua VM, sets up KEYS/ARGV tables, provides `redis.call()`,
/// and holds the db mutex for the entire execution via `lua.scope()`.
pub fn eval_script(
    script: &str,
    keys: Vec<String>,
    args: Vec<Bytes>,
    state: &mut MutexGuard<'_, State>,
) -> Result<Frame, String> {
    let lua = Lua::new();

    // Limit script execution to prevent infinite loops (similar to Redis's lua-time-limit).
    lua.set_hook(
        mlua::HookTriggers::new().every_nth_instruction(100_000),
        |_lua, _debug| {
            Err(LuaError::RuntimeError(
                "ERR script exceeded maximum instruction count".into(),
            ))
        },
    )
    .map_err(|e| e.to_string())?;

    // Set up KEYS table (1-indexed).
    let keys_table = lua.create_table().map_err(|e| e.to_string())?;
    for (i, key) in keys.iter().enumerate() {
        keys_table
            .set(i + 1, key.as_str())
            .map_err(|e| e.to_string())?;
    }
    lua.globals()
        .set("KEYS", keys_table)
        .map_err(|e| e.to_string())?;

    // Set up ARGV table (1-indexed) — push raw bytes to preserve binary data.
    let argv_table = lua.create_table().map_err(|e| e.to_string())?;
    for (i, arg) in args.iter().enumerate() {
        let lua_str = lua.create_string(arg.as_ref()).map_err(|e| e.to_string())?;
        argv_table.set(i + 1, lua_str).map_err(|e| e.to_string())?;
    }
    lua.globals()
        .set("ARGV", argv_table)
        .map_err(|e| e.to_string())?;

    // Use a RefCell to allow the closure to borrow state mutably.
    let state_ref = RefCell::new(state);

    // lua.scope() closure returns Result<Frame, mlua::Error>.
    // We map to String at the outer level.
    lua.scope(|scope| {
        // Create redis.call() function.
        let call_fn = scope.create_function_mut(|lua, args: LuaMultiValue| {
            let args_vec: Vec<LuaValue> = args.into_vec();
            if args_vec.is_empty() {
                return Err(LuaError::RuntimeError(
                    "redis.call() requires at least one argument".into(),
                ));
            }

            let cmd = match &args_vec[0] {
                LuaValue::String(s) => s.to_str()?.to_uppercase(),
                _ => {
                    return Err(LuaError::RuntimeError(
                        "redis.call() first argument must be a string".into(),
                    ));
                }
            };

            let str_args: Vec<String> = args_vec[1..]
                .iter()
                .map(lua_value_to_string)
                .collect::<Result<_, _>>()?;

            let mut guard = state_ref.borrow_mut();

            match cmd.as_str() {
                "GET" => {
                    if str_args.len() != 1 {
                        return Err(LuaError::RuntimeError(
                            "ERR wrong number of arguments for 'GET'".into(),
                        ));
                    }
                    match guard.get_string(&str_args[0]) {
                        Ok(Some(val)) => Ok(LuaValue::String(lua.create_string(val.as_ref())?)),
                        Ok(None) => Ok(LuaValue::Boolean(false)),
                        Err(e) => Err(LuaError::RuntimeError(e)),
                    }
                }
                "SET" => {
                    if str_args.len() < 2 {
                        return Err(LuaError::RuntimeError(
                            "ERR wrong number of arguments for 'SET'".into(),
                        ));
                    }
                    let key = str_args[0].clone();
                    let val = Bytes::from(str_args[1].clone());

                    // Parse optional EX/PX arguments.
                    let mut expire = None;
                    let mut i = 2;
                    while i < str_args.len() {
                        match str_args[i].to_uppercase().as_str() {
                            "EX" => {
                                i += 1;
                                if i >= str_args.len() {
                                    return Err(LuaError::RuntimeError("ERR syntax error".into()));
                                }
                                let secs: i64 = str_args[i].parse().map_err(|_| {
                                    LuaError::RuntimeError("ERR value is not an integer".into())
                                })?;
                                if secs <= 0 {
                                    return Err(LuaError::RuntimeError(
                                        "ERR invalid expire time in 'SET' command".into(),
                                    ));
                                }
                                expire = Some(Duration::from_secs(secs as u64));
                            }
                            "PX" => {
                                i += 1;
                                if i >= str_args.len() {
                                    return Err(LuaError::RuntimeError("ERR syntax error".into()));
                                }
                                let ms: i64 = str_args[i].parse().map_err(|_| {
                                    LuaError::RuntimeError("ERR value is not an integer".into())
                                })?;
                                if ms <= 0 {
                                    return Err(LuaError::RuntimeError(
                                        "ERR invalid expire time in 'SET' command".into(),
                                    ));
                                }
                                expire = Some(Duration::from_millis(ms as u64));
                            }
                            other => {
                                return Err(LuaError::RuntimeError(format!(
                                    "ERR Unsupported SET option '{}'",
                                    other
                                )));
                            }
                        }
                        i += 1;
                    }

                    guard.set(key, Value::String(val), expire);
                    Ok(LuaValue::String(lua.create_string("OK")?))
                }
                "DEL" | "DELETE" => {
                    let mut count = 0i64;
                    for key in &str_args {
                        if guard.remove(key) {
                            count += 1;
                        }
                    }
                    Ok(LuaValue::Integer(count))
                }
                "EXPIRE" => {
                    if str_args.len() != 2 {
                        return Err(LuaError::RuntimeError(
                            "ERR wrong number of arguments for 'EXPIRE'".into(),
                        ));
                    }
                    let key = &str_args[0];
                    let secs: i64 = str_args[1].parse().map_err(|_| {
                        LuaError::RuntimeError("ERR value is not an integer".into())
                    })?;
                    if secs <= 0 {
                        return Err(LuaError::RuntimeError(
                            "ERR invalid expire time in 'EXPIRE' command".into(),
                        ));
                    }

                    let result = if guard.set_expire(key, secs) { 1 } else { 0 };
                    Ok(LuaValue::Integer(result))
                }
                _ => Err(LuaError::RuntimeError(format!(
                    "ERR unsupported command in Lua: {}",
                    cmd
                ))),
            }
        })?;

        // Create redis table with call function.
        let redis_table = lua.create_table()?;
        redis_table.set("call", call_fn)?;
        lua.globals().set("redis", redis_table)?;

        // Execute the script.
        let result: LuaValue = lua.load(script).eval()?;

        // Convert Lua result to Frame.
        Ok(lua_to_frame(result))
    })
    .map_err(|e| e.to_string())
}

/// Convert a Lua value to a RESP Frame.
fn lua_to_frame(value: LuaValue) -> Frame {
    match value {
        LuaValue::Nil => Frame::NullBulk,
        LuaValue::Boolean(false) => Frame::NullBulk,
        LuaValue::Boolean(true) => Frame::Integer(1),
        LuaValue::Integer(n) => Frame::Integer(n),
        LuaValue::Number(n) => Frame::Integer(n as i64),
        LuaValue::String(s) => {
            let bytes = s.as_bytes();
            Frame::Bulk(Bytes::copy_from_slice(&bytes))
        }
        LuaValue::Table(t) => {
            // Check if it's an array (sequential integer keys starting at 1).
            let mut arr = Vec::new();
            let mut i = 1;
            loop {
                match t.get::<LuaValue>(i) {
                    Ok(LuaValue::Nil) => break,
                    Ok(v) => arr.push(lua_to_frame(v)),
                    Err(_) => break,
                }
                i += 1;
            }
            Frame::Array(arr)
        }
        _ => Frame::NullBulk,
    }
}

/// Convert a Lua value to a String for use as a command argument.
fn lua_value_to_string(value: &LuaValue) -> Result<String, LuaError> {
    match value {
        LuaValue::String(s) => Ok(s.to_str()?.to_string()),
        LuaValue::Integer(n) => Ok(n.to_string()),
        LuaValue::Number(n) => Ok(n.to_string()),
        _ => Err(LuaError::RuntimeError(
            "invalid argument type for redis.call()".into(),
        )),
    }
}
