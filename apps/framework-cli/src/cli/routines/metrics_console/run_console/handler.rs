use crate::cli::routines::metrics_console::run_console::app::State;
use crate::cli::routines::metrics_console::run_console::app::{App, AppResult};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::app::TableState;

pub async fn handle_key_events(key_event: KeyEvent, app: &mut App) -> AppResult<()> {
    match key_event.code {
        KeyCode::Char('q') | KeyCode::Char('Q') => {
            app.quit();
        }
        KeyCode::Char('c') | KeyCode::Char('C') if key_event.modifiers == KeyModifiers::CONTROL => {
            app.quit();
        }

        KeyCode::Down => match app.table_state {
            TableState::Endpoint => {
                app.endpoint_down();
            }
            TableState::Kafka => {
                app.kafka_down();
            }
            TableState::StreamingFunction => {
                app.streaming_functions_down();
            }
        },

        KeyCode::Up => match app.table_state {
            TableState::Endpoint => {
                app.endpoint_up();
            }
            TableState::Kafka => {
                app.kafka_up();
            }
            TableState::StreamingFunction => {
                app.streaming_functions_up();
            }
        },
        KeyCode::Tab => match app.table_state {
            TableState::Endpoint => {
                app.table_state = TableState::Kafka;
            }
            TableState::Kafka => {
                app.table_state = TableState::StreamingFunction;
            }
            TableState::StreamingFunction => {
                app.table_state = TableState::Endpoint;
            }
        },

        KeyCode::Enter
            if !app.overview_data.summary.is_empty()
                && matches!(app.table_state, TableState::Endpoint) =>
        {
            app.set_state(State::PathDetails(
                app.overview_data.summary[app.table_scroll_data.endpoint_starting_row]
                    .path
                    .to_string(),
            ));
        }
        KeyCode::Esc => match app.state {
            State::Main() => {
                app.quit();
            }
            State::PathDetails(_) => {
                app.set_state(State::Main());
            }
        },
        _ => {}
    }
    Ok(())
}
