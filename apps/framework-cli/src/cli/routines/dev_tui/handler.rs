//! Keyboard input handling for Dev TUI
//!
//! This module processes keyboard events and updates the application state accordingly.

use super::alert::AlertAction;
use super::app::{DevTuiApp, LogFilter, LogSource, Panel};
use super::DevTuiResult;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// Handle keyboard events
///
/// # Arguments
/// * `key_event` - The key event to handle
/// * `app` - Mutable reference to the application state
///
/// # Returns
/// * `DevTuiResult<()>` - Success or error
pub fn handle_key_events(key_event: KeyEvent, app: &mut DevTuiApp) -> DevTuiResult<()> {
    // If an alert is shown, route to alert handler
    if app.has_alert() {
        return handle_alert_key_events(key_event, app);
    }

    match key_event.code {
        // Quit commands
        KeyCode::Char('q') | KeyCode::Esc => {
            app.quit();
        }
        // Ctrl+C also quits
        KeyCode::Char('c') if key_event.modifiers.contains(KeyModifiers::CONTROL) => {
            app.quit();
        }

        // Panel switching with number keys
        KeyCode::Char('1') => {
            app.switch_panel(Panel::Logs);
        }
        KeyCode::Char('2') => {
            app.switch_panel(Panel::Infrastructure);
        }
        KeyCode::Char('3') => {
            app.switch_panel(Panel::Resources);
        }

        // Tab toggles between panels
        KeyCode::Tab => {
            app.toggle_panel();
        }

        // Clear resource filter
        KeyCode::Char('c') => {
            app.clear_resource_filter();
        }

        // Vim-like navigation (context-sensitive)
        KeyCode::Char('j') | KeyCode::Down => {
            if app.active_panel == Panel::Resources {
                app.resource_navigate_down();
            } else {
                app.scroll_down();
            }
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if app.active_panel == Panel::Resources {
                app.resource_navigate_up();
            } else {
                app.scroll_up();
            }
        }
        KeyCode::Char('g') => {
            if app.active_panel == Panel::Resources {
                app.resource_scroll_to_top();
            } else {
                app.scroll_to_top();
            }
        }
        KeyCode::Char('G') => {
            if app.active_panel == Panel::Resources {
                app.resource_scroll_to_bottom();
            } else {
                app.scroll_to_bottom();
            }
        }

        // Select resource / toggle group
        KeyCode::Enter => {
            if app.active_panel == Panel::Resources {
                app.select_current_resource();
            }
        }

        // Toggle expand/collapse for resource group
        KeyCode::Char(' ') => {
            if app.active_panel == Panel::Resources {
                app.toggle_resource_group();
            }
        }

        // Page up/down
        KeyCode::PageUp => {
            for _ in 0..10 {
                if app.active_panel == Panel::Resources {
                    app.resource_navigate_up();
                } else {
                    app.scroll_up();
                }
            }
        }
        KeyCode::PageDown => {
            for _ in 0..10 {
                if app.active_panel == Panel::Resources {
                    app.resource_navigate_down();
                } else {
                    app.scroll_down();
                }
            }
        }

        // Toggle log line wrapping
        KeyCode::Char('W') => {
            app.toggle_log_wrap();
        }

        // Filter shortcuts
        KeyCode::Char('a') => {
            app.set_filter(LogFilter::All);
        }
        KeyCode::Char('w') => {
            app.set_filter(LogFilter::Source(LogSource::Watcher));
        }
        KeyCode::Char('i') => {
            app.set_filter(LogFilter::Source(LogSource::Infrastructure));
        }
        KeyCode::Char('s') => {
            app.set_filter(LogFilter::Source(LogSource::WebServer));
        }
        KeyCode::Char('e') => {
            app.set_filter(LogFilter::Level(super::app::LogLevel::Error));
        }

        _ => {}
    }

    Ok(())
}

/// Handle keyboard events when an alert is displayed
///
/// # Arguments
/// * `key_event` - The key event to handle
/// * `app` - Mutable reference to the application state
///
/// # Returns
/// * `DevTuiResult<()>` - Success or error
pub fn handle_alert_key_events(key_event: KeyEvent, app: &mut DevTuiApp) -> DevTuiResult<()> {
    let Some(ref mut alert) = app.alert else {
        return Ok(());
    };

    match key_event.code {
        // Navigate between actions
        KeyCode::Tab | KeyCode::Right | KeyCode::Char('l') => {
            alert.select_next();
        }
        KeyCode::BackTab | KeyCode::Left | KeyCode::Char('h') => {
            alert.select_prev();
        }

        // Execute selected action
        KeyCode::Enter => {
            if let Some(action) = alert.selected() {
                match action {
                    AlertAction::Dismiss => {
                        app.dismiss_alert();
                    }
                    AlertAction::Retry => {
                        app.retry_infra = true;
                        app.dismiss_alert();
                    }
                    AlertAction::Quit => {
                        app.dismiss_alert();
                        app.quit();
                    }
                }
            }
        }

        // Escape dismisses the alert
        KeyCode::Esc => {
            app.dismiss_alert();
        }

        // Ctrl+C quits even with alert open
        KeyCode::Char('c') if key_event.modifiers.contains(KeyModifiers::CONTROL) => {
            app.dismiss_alert();
            app.quit();
        }

        _ => {}
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::routines::dev_tui::app::LogLevel;
    use crate::cli::routines::dev_tui::test_utils::*;
    use crossterm::event::KeyCode;

    // ==========================================================================
    // Quit Tests
    // ==========================================================================

    #[test]
    fn q_quits_app() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Char('q')), &mut app).unwrap();
        assert!(!app.running);
    }

    #[test]
    fn escape_quits_app() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Esc), &mut app).unwrap();
        assert!(!app.running);
    }

    #[test]
    fn ctrl_c_quits_app() {
        let mut app = test_app();
        handle_key_events(ctrl_key('c'), &mut app).unwrap();
        assert!(!app.running);
    }

    // ==========================================================================
    // Panel Switching Tests
    // ==========================================================================

    #[test]
    fn key_1_switches_to_logs() {
        let mut app = test_app();
        app.active_panel = Panel::Infrastructure;
        handle_key_events(key(KeyCode::Char('1')), &mut app).unwrap();
        assert_eq!(app.active_panel, Panel::Logs);
    }

    #[test]
    fn key_2_switches_to_infrastructure() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Char('2')), &mut app).unwrap();
        assert_eq!(app.active_panel, Panel::Infrastructure);
    }

    #[test]
    fn tab_toggles_panel() {
        let mut app = test_app();
        assert_eq!(app.active_panel, Panel::Logs);
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        assert_eq!(app.active_panel, Panel::Infrastructure);
    }

    #[test]
    fn tab_toggles_panel_infrastructure_to_resources() {
        let mut app = test_app();
        app.active_panel = Panel::Infrastructure;
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        assert_eq!(app.active_panel, Panel::Resources);
    }

    #[test]
    fn tab_toggles_panel_resources_to_logs() {
        let mut app = test_app();
        app.active_panel = Panel::Resources;
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        assert_eq!(app.active_panel, Panel::Logs);
    }

    // ==========================================================================
    // Navigation Tests
    // ==========================================================================

    #[test]
    fn j_scrolls_down() {
        let mut app = test_app_with_logs(20);
        handle_key_events(key(KeyCode::Char('j')), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 1);
    }

    #[test]
    fn down_arrow_scrolls_down() {
        let mut app = test_app_with_logs(20);
        handle_key_events(key(KeyCode::Down), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 1);
    }

    #[test]
    fn k_scrolls_up() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 5;
        handle_key_events(key(KeyCode::Char('k')), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 4);
    }

    #[test]
    fn up_arrow_scrolls_up() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 5;
        handle_key_events(key(KeyCode::Up), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 4);
    }

    #[test]
    fn g_scrolls_to_top() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.offset = 10;
        handle_key_events(key(KeyCode::Char('g')), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 0);
    }

    #[test]
    fn shift_g_scrolls_to_bottom() {
        let mut app = test_app_with_logs(20);
        app.log_scroll.auto_scroll = false;
        handle_key_events(key(KeyCode::Char('G')), &mut app).unwrap();
        assert!(app.log_scroll.auto_scroll);
        assert_eq!(app.log_scroll.offset, 19);
    }

    #[test]
    fn page_up_scrolls_multiple_lines() {
        let mut app = test_app_with_logs(50);
        app.log_scroll.offset = 20;
        handle_key_events(key(KeyCode::PageUp), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 10);
    }

    #[test]
    fn page_down_scrolls_multiple_lines() {
        let mut app = test_app_with_logs(50);
        app.log_scroll.offset = 0;
        handle_key_events(key(KeyCode::PageDown), &mut app).unwrap();
        assert_eq!(app.log_scroll.offset, 10);
    }

    // ==========================================================================
    // Filter Tests
    // ==========================================================================

    #[test]
    fn a_sets_filter_all() {
        let mut app = test_app();
        app.filter = LogFilter::Source(LogSource::Watcher);
        handle_key_events(key(KeyCode::Char('a')), &mut app).unwrap();
        assert!(matches!(app.filter, LogFilter::All));
    }

    #[test]
    fn w_sets_filter_watcher() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Char('w')), &mut app).unwrap();
        assert!(matches!(app.filter, LogFilter::Source(LogSource::Watcher)));
    }

    #[test]
    fn i_sets_filter_infrastructure() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Char('i')), &mut app).unwrap();
        assert!(matches!(
            app.filter,
            LogFilter::Source(LogSource::Infrastructure)
        ));
    }

    #[test]
    fn s_sets_filter_webserver() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Char('s')), &mut app).unwrap();
        assert!(matches!(
            app.filter,
            LogFilter::Source(LogSource::WebServer)
        ));
    }

    #[test]
    fn e_sets_filter_error() {
        let mut app = test_app();
        handle_key_events(key(KeyCode::Char('e')), &mut app).unwrap();
        assert!(matches!(app.filter, LogFilter::Level(LogLevel::Error)));
    }

    // ==========================================================================
    // Unknown Key Tests
    // ==========================================================================

    #[test]
    fn unknown_key_does_nothing() {
        let mut app = test_app();
        let initial_panel = app.active_panel;
        let initial_running = app.running;
        let initial_offset = app.log_scroll.offset;

        handle_key_events(key(KeyCode::Char('z')), &mut app).unwrap();

        assert_eq!(app.active_panel, initial_panel);
        assert_eq!(app.running, initial_running);
        assert_eq!(app.log_scroll.offset, initial_offset);
    }

    #[test]
    fn function_key_does_nothing() {
        let mut app = test_app();
        let initial_running = app.running;

        handle_key_events(key(KeyCode::F(1)), &mut app).unwrap();

        assert_eq!(app.running, initial_running);
    }

    // ==========================================================================
    // Return Value Tests
    // ==========================================================================

    #[test]
    fn handle_key_events_returns_ok() {
        let mut app = test_app();
        let result = handle_key_events(key(KeyCode::Char('q')), &mut app);
        assert!(result.is_ok());
    }

    // ==========================================================================
    // Alert Key Handling Tests
    // ==========================================================================

    fn app_with_alert() -> crate::cli::routines::dev_tui::app::DevTuiApp {
        let mut app = test_app();
        app.show_alert(crate::cli::routines::dev_tui::alert::Alert::docker_not_running());
        app
    }

    #[test]
    fn alert_routes_to_alert_handler() {
        let mut app = app_with_alert();
        // 'q' normally quits, but with alert open it should not
        handle_key_events(key(KeyCode::Char('q')), &mut app).unwrap();
        // App should still be running because 'q' is not handled in alert mode
        assert!(app.running);
    }

    #[test]
    fn alert_tab_selects_next_action() {
        let mut app = app_with_alert();
        let initial_selection = app.alert.as_ref().unwrap().selected_action;
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        assert_ne!(
            app.alert.as_ref().unwrap().selected_action,
            initial_selection
        );
    }

    #[test]
    fn alert_right_arrow_selects_next_action() {
        let mut app = app_with_alert();
        let initial_selection = app.alert.as_ref().unwrap().selected_action;
        handle_key_events(key(KeyCode::Right), &mut app).unwrap();
        assert_ne!(
            app.alert.as_ref().unwrap().selected_action,
            initial_selection
        );
    }

    #[test]
    fn alert_left_arrow_selects_prev_action() {
        let mut app = app_with_alert();
        // First move to next, then back
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        let selection_after_tab = app.alert.as_ref().unwrap().selected_action;
        handle_key_events(key(KeyCode::Left), &mut app).unwrap();
        assert_ne!(
            app.alert.as_ref().unwrap().selected_action,
            selection_after_tab
        );
    }

    #[test]
    fn alert_escape_dismisses_alert() {
        let mut app = app_with_alert();
        assert!(app.has_alert());
        handle_key_events(key(KeyCode::Esc), &mut app).unwrap();
        assert!(!app.has_alert());
    }

    #[test]
    fn alert_enter_on_quit_quits_app() {
        let mut app = app_with_alert();
        // Move to Quit action (second action in docker_not_running alert)
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        assert!(app.running);
        handle_key_events(key(KeyCode::Enter), &mut app).unwrap();
        assert!(!app.running);
    }

    #[test]
    fn alert_enter_on_retry_sets_retry_flag() {
        let mut app = app_with_alert();
        // Retry is the first action in docker_not_running alert
        assert!(!app.retry_infra);
        handle_key_events(key(KeyCode::Enter), &mut app).unwrap();
        assert!(app.retry_infra);
        assert!(!app.has_alert()); // Alert should be dismissed
    }

    #[test]
    fn alert_ctrl_c_quits_even_with_alert() {
        let mut app = app_with_alert();
        assert!(app.running);
        handle_key_events(ctrl_key('c'), &mut app).unwrap();
        assert!(!app.running);
        assert!(!app.has_alert()); // Alert should be dismissed
    }

    #[test]
    fn alert_l_selects_next_action() {
        let mut app = app_with_alert();
        let initial_selection = app.alert.as_ref().unwrap().selected_action;
        handle_key_events(key(KeyCode::Char('l')), &mut app).unwrap();
        assert_ne!(
            app.alert.as_ref().unwrap().selected_action,
            initial_selection
        );
    }

    #[test]
    fn alert_h_selects_prev_action() {
        let mut app = app_with_alert();
        // First move to next, then back with 'h'
        handle_key_events(key(KeyCode::Tab), &mut app).unwrap();
        let selection_after_tab = app.alert.as_ref().unwrap().selected_action;
        handle_key_events(key(KeyCode::Char('h')), &mut app).unwrap();
        assert_ne!(
            app.alert.as_ref().unwrap().selected_action,
            selection_after_tab
        );
    }

    #[test]
    fn no_alert_does_not_route_to_alert_handler() {
        let mut app = test_app();
        assert!(!app.has_alert());
        // 'q' should quit normally when no alert
        handle_key_events(key(KeyCode::Char('q')), &mut app).unwrap();
        assert!(!app.running);
    }
}
