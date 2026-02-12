//! UI rendering for Dev TUI
//!
//! This module handles the layout and rendering of all TUI components.
//! The design is inspired by k9s and lazygit with a focus on information density
//! and keyboard-driven navigation.

// Some helper functions are only used conditionally or in tests
#![allow(dead_code)]

use super::alert::{Alert, AlertLevel};
use super::app::{DevTuiApp, HotReloadStatus, LogFilter, LogLevel, LogSource, Panel};
use super::infra_status::{BootPhase, ServiceStatus};
use super::resource_panel::ResourceItem;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::Frame;

/// Main render function for the Dev TUI
pub fn render(app: &DevTuiApp, frame: &mut Frame) {
    // Create the main layout: header, body, footer
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2), // Header
            Constraint::Min(0),    // Body (takes remaining space)
            Constraint::Length(2), // Footer
        ])
        .split(frame.size());

    // Render each section
    render_header(app, frame, chunks[0]);
    render_body(app, frame, chunks[1]);
    render_footer(app, frame, chunks[2]);

    // Render alert modal on top if present
    if let Some(ref alert) = app.alert {
        render_alert_modal(alert, frame);
    }
}

/// Render the header with project info and summary
fn render_header(app: &DevTuiApp, frame: &mut Frame, area: Rect) {
    let project_name = app.project.name();
    let language = format!("{:?}", app.project.language);
    let port = app.project.http_server_config.port;

    // Build header text with optional loading indicator
    let status = if app.resources_loading {
        format!("{} Applying changes...", app.spinner_char())
    } else {
        format!("localhost:{}", port)
    };

    let header_text = format!(" MOOSE DEV  {}  {}  {}", project_name, language, status);

    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::White).bg(Color::DarkGray))
        .block(Block::default());

    frame.render_widget(header, area);
}

/// Render the main body with three panels
fn render_body(app: &DevTuiApp, frame: &mut Frame, area: Rect) {
    // Split body horizontally: 60% logs, 40% right side
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(60), // Logs panel
            Constraint::Percentage(40), // Right side (Infrastructure + Resources)
        ])
        .split(area);

    render_logs_panel(app, frame, main_chunks[0]);

    // Split right side vertically: Infrastructure (top), Resources (bottom)
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(40), // Infrastructure panel
            Constraint::Percentage(60), // Resources panel
        ])
        .split(main_chunks[1]);

    render_infrastructure_panel(app, frame, right_chunks[0]);
    render_resources_panel(app, frame, right_chunks[1]);
}

/// Render the logs panel
fn render_logs_panel(app: &DevTuiApp, frame: &mut Frame, area: Rect) {
    let is_active = app.active_panel == Panel::Logs;

    // Panel title with number indicator and optional resource filter
    let title = if let Some(ref resource) = app.selected_resource {
        format!(
            " [1] LOGS ({}) [{}] ",
            app.filtered_log_count(),
            resource.name
        )
    } else {
        format!(" [1] LOGS ({}) ", app.filtered_log_count())
    };
    let border_style = if is_active {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    // Get filtered logs
    let filtered_logs = app.filtered_logs();

    // Calculate visible area
    let inner_area = block.inner(area);
    let visible_count = inner_area.height as usize;
    let panel_width = inner_area.width as usize;

    if app.log_wrap {
        // Wrapped mode: each log entry may span multiple display lines.
        // The prefix "HH:MM:SS SRC   " is 15 chars; continuation lines are indented to align.
        let prefix_len = 15; // "HH:MM:SS SRC   "
        let msg_width = panel_width.saturating_sub(prefix_len).max(10);

        // Pre-compute all display lines with their styles
        let mut all_display_lines: Vec<Line> = Vec::new();
        for entry in &filtered_logs {
            let timestamp = entry.timestamp.format("%H:%M:%S").to_string();
            let source_style = get_source_style(entry.source);
            let level_style = get_level_style(entry.level);

            let msg = &entry.message;
            if msg.len() <= msg_width {
                // Single line
                all_display_lines.push(Line::from(vec![
                    Span::styled(timestamp, Style::default().fg(Color::DarkGray)),
                    Span::raw(" "),
                    Span::styled(format!("{:<5}", entry.source.short_name()), source_style),
                    Span::raw(" "),
                    Span::styled(msg.to_string(), level_style),
                ]));
            } else {
                // Break message into chunks
                let mut chars = msg.chars().peekable();
                let mut first = true;
                while chars.peek().is_some() {
                    let chunk: String = chars.by_ref().take(msg_width).collect();
                    if first {
                        all_display_lines.push(Line::from(vec![
                            Span::styled(timestamp.clone(), Style::default().fg(Color::DarkGray)),
                            Span::raw(" "),
                            Span::styled(format!("{:<5}", entry.source.short_name()), source_style),
                            Span::raw(" "),
                            Span::styled(chunk, level_style),
                        ]));
                        first = false;
                    } else {
                        all_display_lines.push(Line::from(vec![
                            Span::raw(" ".repeat(prefix_len)),
                            Span::styled(chunk, level_style),
                        ]));
                    }
                }
            }
        }

        let total_display_lines = all_display_lines.len();
        let start_idx = if app.log_scroll.auto_scroll {
            total_display_lines.saturating_sub(visible_count)
        } else {
            app.log_scroll
                .offset
                .min(total_display_lines.saturating_sub(visible_count))
        };

        let visible_lines: Vec<ListItem> = all_display_lines
            .into_iter()
            .skip(start_idx)
            .take(visible_count)
            .map(ListItem::new)
            .collect();

        let list = List::new(visible_lines).block(block);
        frame.render_widget(list, area);
    } else {
        // Non-wrapped (truncated) mode: one log entry per line
        let total_logs = filtered_logs.len();
        let start_idx = if app.log_scroll.auto_scroll {
            total_logs.saturating_sub(visible_count)
        } else {
            app.log_scroll
                .offset
                .min(total_logs.saturating_sub(visible_count))
        };

        let items: Vec<ListItem> = filtered_logs
            .iter()
            .skip(start_idx)
            .take(visible_count)
            .map(|entry| {
                let timestamp = entry.timestamp.format("%H:%M:%S").to_string();
                let source_style = get_source_style(entry.source);
                let level_style = get_level_style(entry.level);

                let line = Line::from(vec![
                    Span::styled(timestamp, Style::default().fg(Color::DarkGray)),
                    Span::raw(" "),
                    Span::styled(format!("{:<5}", entry.source.short_name()), source_style),
                    Span::raw(" "),
                    Span::styled(&entry.message, level_style),
                ]);

                ListItem::new(line)
            })
            .collect();

        let list = List::new(items).block(block);
        frame.render_widget(list, area);
    }

    // Show scroll indicator if not auto-scrolling
    if !app.log_scroll.auto_scroll && filtered_logs.len() > visible_count {
        let indicator = Paragraph::new(" Manual scroll (G to follow) ").style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::DIM),
        );
        let indicator_area = Rect {
            x: area.x + 1,
            y: area.y + area.height - 2,
            width: 28,
            height: 1,
        };
        frame.render_widget(indicator, indicator_area);
    }
}

/// Render the infrastructure panel
fn render_infrastructure_panel(app: &DevTuiApp, frame: &mut Frame, area: Rect) {
    let is_active = app.active_panel == Panel::Infrastructure;

    let title = " [2] INFRASTRUCTURE ";
    let border_style = if is_active {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let infra = &app.infra_status;
    let mut content = Vec::new();

    // Boot status section
    content.push(Line::from(vec![Span::styled(
        "  BOOT STATUS",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));
    content.push(Line::from(vec![
        Span::raw("  "),
        Span::styled(
            format!("{} ", get_phase_icon(infra.phase)),
            get_phase_style(infra.phase),
        ),
        Span::styled(infra.phase.description(), get_phase_style(infra.phase)),
    ]));
    content.push(Line::from(""));

    // Services section
    content.push(Line::from(vec![Span::styled(
        "  SERVICES",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));

    // Docker
    content.push(render_service_line("Docker", &infra.docker));

    // ClickHouse
    if let Some(ref status) = infra.clickhouse {
        content.push(render_service_line("ClickHouse", status));
    }

    // Redis
    if let Some(ref status) = infra.redis {
        content.push(render_service_line("Redis", status));
    }

    // Temporal
    if let Some(ref status) = infra.temporal {
        content.push(render_service_line("Temporal", status));
    }

    // Redpanda
    if let Some(ref status) = infra.redpanda {
        content.push(render_service_line("Redpanda", status));
    }

    content.push(Line::from(""));

    // Web Server section
    content.push(Line::from(vec![Span::styled(
        "  WEB SERVER",
        Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
    )]));

    let web_status_line = if app.web_server_started {
        Line::from(vec![
            Span::raw("  "),
            Span::styled("● ", Style::default().fg(Color::Green)),
            Span::styled(
                format!("Running on port {}", app.project.http_server_config.port),
                Style::default().fg(Color::Green),
            ),
        ])
    } else if app.infra_ready {
        Line::from(vec![
            Span::raw("  "),
            Span::styled("◐ ", Style::default().fg(Color::Yellow)),
            Span::styled("Starting...", Style::default().fg(Color::Yellow)),
        ])
    } else {
        Line::from(vec![
            Span::raw("  "),
            Span::styled("○ ", Style::default().fg(Color::DarkGray)),
            Span::styled("Waiting for infra...", Style::default().fg(Color::DarkGray)),
        ])
    };
    content.push(web_status_line);

    // Hot Reload section (only shown when web server is running)
    if app.web_server_started {
        content.push(Line::from(""));
        content.push(Line::from(vec![Span::styled(
            "  HOT RELOAD",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )]));

        let hot_reload_line = match &app.hot_reload {
            HotReloadStatus::Idle => Line::from(vec![
                Span::raw("  "),
                Span::styled("● ", Style::default().fg(Color::DarkGray)),
                Span::styled("Watching for changes", Style::default().fg(Color::DarkGray)),
            ]),
            HotReloadStatus::Reloading => Line::from(vec![
                Span::raw("  "),
                Span::styled(
                    format!("{} ", app.spinner_char()),
                    Style::default().fg(Color::Yellow),
                ),
                Span::styled("Reloading...", Style::default().fg(Color::Yellow)),
            ]),
            HotReloadStatus::Success => Line::from(vec![
                Span::raw("  "),
                Span::styled("● ", Style::default().fg(Color::Green)),
                Span::styled("Ready", Style::default().fg(Color::Green)),
            ]),
            HotReloadStatus::Failed(msg) => {
                // Show a truncated error on one line
                let short_msg = if msg.len() > 40 {
                    format!("{}...", &msg[..40])
                } else {
                    msg.clone()
                };
                Line::from(vec![
                    Span::raw("  "),
                    Span::styled("✗ ", Style::default().fg(Color::Red)),
                    Span::styled(short_msg, Style::default().fg(Color::Red)),
                ])
            }
        };
        content.push(hot_reload_line);
    }

    let paragraph = Paragraph::new(content).block(block);

    frame.render_widget(paragraph, area);
}

/// Render the resources panel
fn render_resources_panel(app: &DevTuiApp, frame: &mut Frame, area: Rect) {
    let is_active = app.active_panel == Panel::Resources;

    // Panel title with optional loading spinner
    let title = if app.resources_loading {
        format!(" [3] RESOURCES {} ", app.spinner_char())
    } else {
        format!(" [3] RESOURCES ({}) ", app.resource_list.total_count())
    };

    let border_style = if is_active {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(border_style);

    let inner_area = block.inner(area);
    frame.render_widget(block, area);

    // Show loading state if resources are being applied
    if app.resources_loading {
        let loading = Paragraph::new(format!("\n  {} Applying changes...", app.spinner_char()))
            .style(Style::default().fg(Color::Yellow));
        frame.render_widget(loading, inner_area);
        return;
    }

    // Get resource items for rendering
    let items = app.get_resource_items();

    if items.is_empty() {
        let empty_msg = if app.infra_ready && app.web_server_started {
            Paragraph::new(vec![
                Line::from(""),
                Line::from(Span::styled(
                    "  No resources yet.",
                    Style::default().fg(Color::DarkGray),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "  Create a Moose resource to see",
                    Style::default().fg(Color::DarkGray),
                )),
                Line::from(Span::styled(
                    "  it appear here.",
                    Style::default().fg(Color::DarkGray),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "  https://docs.moosejs.com",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::UNDERLINED),
                )),
            ])
        } else {
            Paragraph::new("\n  No resources yet.\n  Waiting for infrastructure...")
                .style(Style::default().fg(Color::DarkGray))
        };
        frame.render_widget(empty_msg, inner_area);
        return;
    }

    // Calculate visible area
    let visible_count = inner_area.height as usize;

    // Calculate scroll offset to keep cursor visible
    let scroll_offset = if app.resource_cursor >= visible_count {
        app.resource_cursor - visible_count + 1
    } else {
        0
    };

    // Create list items
    let list_items: Vec<ListItem> = items
        .iter()
        .enumerate()
        .skip(scroll_offset)
        .take(visible_count)
        .map(|(idx, item)| {
            let is_cursor = idx == app.resource_cursor;
            let is_selected = app
                .selected_resource
                .as_ref()
                .map(|r| {
                    if let ResourceItem::Resource {
                        resource_type,
                        name,
                    } = item
                    {
                        r.resource_type == *resource_type && r.name == *name
                    } else {
                        false
                    }
                })
                .unwrap_or(false);

            match item {
                ResourceItem::GroupHeader {
                    resource_type,
                    count,
                    expanded,
                } => {
                    let arrow = if *expanded { '▼' } else { '▶' };
                    let text = format!("{} {} ({})", arrow, resource_type.display_name(), count);
                    let style = if is_cursor {
                        Style::default()
                            .fg(Color::Yellow)
                            .add_modifier(Modifier::BOLD)
                            .bg(Color::DarkGray)
                    } else {
                        Style::default()
                            .fg(Color::Yellow)
                            .add_modifier(Modifier::BOLD)
                    };
                    ListItem::new(Line::from(Span::styled(text, style)))
                }
                ResourceItem::Resource { name, .. } => {
                    let prefix = if is_selected { "> " } else { "  " };
                    let text = format!("{}{}", prefix, name);
                    let style = if is_cursor {
                        Style::default().fg(Color::White).bg(Color::DarkGray)
                    } else if is_selected {
                        Style::default().fg(Color::Cyan)
                    } else {
                        Style::default().fg(Color::White)
                    };
                    ListItem::new(Line::from(Span::styled(text, style)))
                }
            }
        })
        .collect();

    let list = List::new(list_items);
    frame.render_widget(list, inner_area);
}

/// Render a service status line
fn render_service_line(name: &str, status: &ServiceStatus) -> Line<'static> {
    let (icon, style) = get_service_status_display(status);
    Line::from(vec![
        Span::raw("  "),
        Span::styled(format!("{} ", icon), style),
        Span::raw(format!("{:<12}", name)),
        Span::styled(status.display(), style),
    ])
}

/// Get display icon and style for a service status
fn get_service_status_display(status: &ServiceStatus) -> (char, Style) {
    match status {
        ServiceStatus::Pending => ('○', Style::default().fg(Color::DarkGray)),
        ServiceStatus::Starting => ('◐', Style::default().fg(Color::Yellow)),
        ServiceStatus::WaitingHealthy { .. } => ('◑', Style::default().fg(Color::Yellow)),
        ServiceStatus::Healthy => ('●', Style::default().fg(Color::Green)),
        ServiceStatus::Skipped => ('○', Style::default().fg(Color::DarkGray)),
        ServiceStatus::Failed(_) => ('✗', Style::default().fg(Color::Red)),
    }
}

/// Get icon for boot phase
fn get_phase_icon(phase: BootPhase) -> char {
    match phase {
        BootPhase::Initializing => '○',
        BootPhase::CheckingDocker => '◐',
        BootPhase::CreatingComposeFile => '◐',
        BootPhase::StartingContainers => '◐',
        BootPhase::ValidatingServices => '◑',
        BootPhase::Ready => '●',
        BootPhase::Failed => '✗',
    }
}

/// Get style for boot phase
fn get_phase_style(phase: BootPhase) -> Style {
    match phase {
        BootPhase::Initializing => Style::default().fg(Color::DarkGray),
        BootPhase::CheckingDocker
        | BootPhase::CreatingComposeFile
        | BootPhase::StartingContainers
        | BootPhase::ValidatingServices => Style::default().fg(Color::Yellow),
        BootPhase::Ready => Style::default().fg(Color::Green),
        BootPhase::Failed => Style::default().fg(Color::Red),
    }
}

/// Render an alert modal centered on the screen
fn render_alert_modal(alert: &Alert, frame: &mut Frame) {
    let area = frame.size();

    // Calculate modal size (centered, ~50% width, auto height)
    let modal_width = (area.width as f32 * 0.6).min(60.0) as u16;
    let modal_height = 12u16; // Fixed height for consistency

    let modal_x = (area.width.saturating_sub(modal_width)) / 2;
    let modal_y = (area.height.saturating_sub(modal_height)) / 2;

    let modal_area = Rect::new(modal_x, modal_y, modal_width, modal_height);

    // Clear the area behind the modal
    frame.render_widget(Clear, modal_area);

    // Determine border color based on alert level
    let border_color = match alert.level {
        AlertLevel::Info => Color::Cyan,
        AlertLevel::Warning => Color::Yellow,
        AlertLevel::Error => Color::Red,
    };

    let block = Block::default()
        .title(format!(" {} ", alert.title))
        .title_style(
            Style::default()
                .fg(border_color)
                .add_modifier(Modifier::BOLD),
        )
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color));

    let inner_area = block.inner(modal_area);
    frame.render_widget(block, modal_area);

    // Split inner area: message, details (optional), actions
    let mut constraints = vec![
        Constraint::Min(3),    // Message
        Constraint::Length(2), // Actions
    ];
    if alert.details.is_some() {
        constraints.insert(1, Constraint::Length(2)); // Details
    }

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(inner_area);

    // Render message
    let message = Paragraph::new(alert.message.clone())
        .style(Style::default().fg(Color::White))
        .wrap(Wrap { trim: true });
    frame.render_widget(message, chunks[0]);

    // Render details if present
    let action_chunk_idx = if alert.details.is_some() {
        let details = Paragraph::new(alert.details.clone().unwrap_or_default())
            .style(Style::default().fg(Color::DarkGray))
            .wrap(Wrap { trim: true });
        frame.render_widget(details, chunks[1]);
        2
    } else {
        1
    };

    // Render action buttons
    let action_spans: Vec<Span> = alert
        .actions
        .iter()
        .enumerate()
        .flat_map(|(i, (_action, label))| {
            let is_selected = i == alert.selected_action;
            let style = if is_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::White)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::DarkGray)
            };
            vec![
                Span::styled(format!(" [{}] ", label), style),
                Span::raw("  "),
            ]
        })
        .collect();

    let actions = Paragraph::new(Line::from(action_spans)).alignment(Alignment::Center);
    frame.render_widget(actions, chunks[action_chunk_idx]);
}

/// Render the footer with keybinding hints
fn render_footer(app: &DevTuiApp, frame: &mut Frame, area: Rect) {
    // First row: Filter options
    let filter_style = Style::default().fg(Color::DarkGray);
    let active_filter_style = Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    let mut filter_spans = vec![
        Span::styled(" Filter: ", Style::default().fg(Color::White)),
        Span::styled(
            "[a]All ",
            if matches!(app.filter, LogFilter::All) {
                active_filter_style
            } else {
                filter_style
            },
        ),
        Span::styled(
            "[w]Watch ",
            if matches!(app.filter, LogFilter::Source(LogSource::Watcher)) {
                active_filter_style
            } else {
                filter_style
            },
        ),
        Span::styled(
            "[i]Infra ",
            if matches!(app.filter, LogFilter::Source(LogSource::Infrastructure)) {
                active_filter_style
            } else {
                filter_style
            },
        ),
        Span::styled(
            "[s]API ",
            if matches!(app.filter, LogFilter::Source(LogSource::WebServer)) {
                active_filter_style
            } else {
                filter_style
            },
        ),
        Span::styled(
            "[e]Error ",
            if matches!(app.filter, LogFilter::Level(LogLevel::Error)) {
                active_filter_style
            } else {
                filter_style
            },
        ),
    ];

    // Add resource filter indicator if active
    if let Some(ref resource) = app.selected_resource {
        filter_spans.push(Span::styled("| ", filter_style));
        filter_spans.push(Span::styled(
            format!("Resource: {} ", resource.name),
            active_filter_style,
        ));
        filter_spans.push(Span::styled("[c]Clear ", filter_style));
    }

    // Second row: Navigation
    let wrap_label = if app.log_wrap {
        "[W]Unwrap "
    } else {
        "[W]Wrap "
    };
    let nav_spans = vec![
        Span::styled(" Nav: ", Style::default().fg(Color::White)),
        Span::styled("[1-3]Panel ", filter_style),
        Span::styled("[j/k]Scroll ", filter_style),
        Span::styled("[Enter]Select ", filter_style),
        Span::styled("[Space]Expand ", filter_style),
        Span::styled(wrap_label, filter_style),
        Span::styled("[q]Quit", filter_style),
    ];

    // Create two-row footer
    let footer_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(1)])
        .split(area);

    let filter_line =
        Paragraph::new(Line::from(filter_spans)).style(Style::default().bg(Color::Black));
    let nav_line = Paragraph::new(Line::from(nav_spans)).style(Style::default().bg(Color::Black));

    frame.render_widget(filter_line, footer_chunks[0]);
    frame.render_widget(nav_line, footer_chunks[1]);
}

/// Get the style for a log source
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn get_source_style(source: LogSource) -> Style {
    match source {
        LogSource::Watcher => Style::default().fg(Color::Cyan),
        LogSource::WebServer => Style::default().fg(Color::Green),
        LogSource::Infrastructure => Style::default().fg(Color::Yellow),
        LogSource::Metrics => Style::default().fg(Color::Magenta),
        LogSource::System => Style::default().fg(Color::White),
    }
}

/// Get the style for a log level
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn get_level_style(level: LogLevel) -> Style {
    match level {
        LogLevel::Debug => Style::default().fg(Color::DarkGray),
        LogLevel::Info => Style::default().fg(Color::White),
        LogLevel::Warning => Style::default().fg(Color::Yellow),
        LogLevel::Error => Style::default().fg(Color::Red),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::routines::dev_tui::app::{LogEntry, LogLevel, LogSource};
    use crate::cli::routines::dev_tui::test_utils::*;
    use insta::assert_snapshot;
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    /// Helper to render app to a string for snapshot testing
    fn render_to_string(app: &DevTuiApp, width: u16, height: u16) -> String {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| render(app, frame)).unwrap();
        terminal.backend().to_string()
    }

    // ==========================================================================
    // Full UI Snapshot Tests
    // ==========================================================================

    #[test]
    fn snapshot_full_ui_empty() {
        let app = test_app();
        let output = render_to_string(&app, 80, 24);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_full_ui_with_logs() {
        let app = test_app_with_logs(10);
        let output = render_to_string(&app, 80, 24);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_infrastructure_panel_active() {
        let mut app = test_app();
        app.active_panel = Panel::Infrastructure;
        let output = render_to_string(&app, 80, 24);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_with_watcher_filter() {
        let mut app = test_app();
        app.set_filter(LogFilter::Source(LogSource::Watcher));
        let output = render_to_string(&app, 80, 24);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_with_error_filter() {
        let mut app = test_app();
        app.set_filter(LogFilter::Level(LogLevel::Error));
        let output = render_to_string(&app, 80, 24);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_with_mixed_logs() {
        use chrono::TimeZone;

        let mut app = test_app();
        // Use fixed timestamp for deterministic snapshots
        let base_time = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();

        app.logs.push(LogEntry {
            timestamp: base_time,
            source: LogSource::Watcher,
            level: LogLevel::Info,
            message: "File changed: models/User.ts".into(),
        });
        app.logs.push(LogEntry {
            timestamp: base_time + chrono::Duration::seconds(1),
            source: LogSource::Infrastructure,
            level: LogLevel::Info,
            message: "Creating table User".into(),
        });
        app.logs.push(LogEntry {
            timestamp: base_time + chrono::Duration::seconds(2),
            source: LogSource::WebServer,
            level: LogLevel::Info,
            message: "Route registered POST /ingest/User".into(),
        });
        app.logs.push(LogEntry {
            timestamp: base_time + chrono::Duration::seconds(3),
            source: LogSource::System,
            level: LogLevel::Error,
            message: "Failed to connect to database".into(),
        });
        let output = render_to_string(&app, 80, 24);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_narrow_terminal() {
        let app = test_app_with_logs(5);
        let output = render_to_string(&app, 60, 20);
        assert_snapshot!(output);
    }

    #[test]
    fn snapshot_wide_terminal() {
        let app = test_app_with_logs(5);
        let output = render_to_string(&app, 120, 30);
        assert_snapshot!(output);
    }

    // ==========================================================================
    // Style Helper Tests (no terminal needed)
    // ==========================================================================

    #[test]
    fn source_style_returns_correct_colors() {
        assert_eq!(get_source_style(LogSource::Watcher).fg, Some(Color::Cyan));
        assert_eq!(
            get_source_style(LogSource::WebServer).fg,
            Some(Color::Green)
        );
        assert_eq!(
            get_source_style(LogSource::Infrastructure).fg,
            Some(Color::Yellow)
        );
        assert_eq!(
            get_source_style(LogSource::Metrics).fg,
            Some(Color::Magenta)
        );
        assert_eq!(get_source_style(LogSource::System).fg, Some(Color::White));
    }

    #[test]
    fn level_style_returns_correct_colors() {
        assert_eq!(get_level_style(LogLevel::Debug).fg, Some(Color::DarkGray));
        assert_eq!(get_level_style(LogLevel::Info).fg, Some(Color::White));
        assert_eq!(get_level_style(LogLevel::Warning).fg, Some(Color::Yellow));
        assert_eq!(get_level_style(LogLevel::Error).fg, Some(Color::Red));
    }

    // ==========================================================================
    // Layout Consistency Tests
    // ==========================================================================

    #[test]
    fn render_does_not_panic_with_minimum_size() {
        let app = test_app();
        // Minimum viable terminal size
        let output = render_to_string(&app, 40, 10);
        assert!(!output.is_empty());
    }

    #[test]
    fn render_does_not_panic_with_many_logs() {
        let app = test_app_with_logs(100);
        let output = render_to_string(&app, 80, 24);
        assert!(!output.is_empty());
    }

    #[test]
    fn render_does_not_panic_with_long_log_message() {
        let mut app = test_app();
        app.logs.push(LogEntry::new(
            LogSource::System,
            LogLevel::Info,
            "A".repeat(200), // Very long message
        ));
        let output = render_to_string(&app, 80, 24);
        assert!(!output.is_empty());
    }
}
