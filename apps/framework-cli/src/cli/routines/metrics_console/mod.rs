use crate::cli::{display::Message, routines::RoutineSuccess};

mod run_console;

use super::RoutineFailure;

pub async fn run_console() -> Result<RoutineSuccess, RoutineFailure> {
    let result = run_console::run_console().await;

    match result {
        Ok(_) => Ok(RoutineSuccess::success(Message::new(
            "".to_string(),
            "".to_string(),
        ))),
        _ => Err(RoutineFailure::error(Message::new(
            "".to_string(),
            "".to_string(),
        ))),
    }
}
