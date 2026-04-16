use std::rc::Rc;

use ratatui::{
    layout::Alignment,
    style::{Color, Style, Stylize},
    Frame,
};
use ratatui::{prelude::*, widgets::*};

use crate::cli::routines::metrics_console::run_console::app::{App, State, TableState};

const INFO_TEXT: &str =
    "(Q) QUIT | (TAB) SWITCH TABLE | (↑) ROW UP | (↓) ROW DOWN | (ENTER) VIEW ENDPOINT DETAILS";

const ENDPOINT_TABLE_COLUMNS: [&str; 4] = [
    "PATH",
    "LATENCY (ms)",
    "# OF REQUESTS RECEIVED",
    "# OF MESSAGES SENT TO KAFKA",
];

const KAFKA_CLICKHOUSE_SYNC_TABLE_COLUMNS: [&str; 5] =
    ["DATA MODEL", "MSG READ", "LAG", "MSG/SEC", "BYTES/SEC"];
const STREAMING_FUNCTIONS_KAFKA_TABLE_COLUMNS: [&str; 6] = [
    "STREAMING PATH",
    "MSG IN",
    "MSG IN/SEC",
    "MSG OUT",
    "MSG OUT/SEC",
    "BYTES/SEC",
];
const PATH_INFO_TEXT: &str = "(ESC) EXIT DETAILED VIEW | (Q) QUIT";
const ENDPOINT_TABLE_TITLE: &str = "ENDPOINT METRICS TABLE";
const KAFKA_CLICKHOUSE_SYNC_TABLE_TITLE: &str = "TOPIC TO TABLE SYNC PROCESSES";
const STREAMING_FUNCTIONS_KAFKA_TABLE_TITLE: &str = "STREAMING FUNCTION PROCESSES";

/// Renders the user interface widgets.
pub fn render(app: &mut App, frame: &mut Frame) {
    match &app.state {
        State::Main() => {
            let outer_layout = Layout::default()
                .direction(Direction::Vertical)
                .constraints(vec![
                    Constraint::Max(2),
                    Constraint::Max(3),
                    Constraint::Max(3),
                    Constraint::Fill(28),
                    Constraint::Max(2),
                    Constraint::Fill(28),
                    Constraint::Fill(28),
                    Constraint::Max(3),
                ])
                .split(frame.size());

            let paragraph_layout = Layout::default()
                .direction(Direction::Vertical)
                .constraints(vec![Constraint::Max(30)])
                .split(outer_layout[1]);

            let inner_layout = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(vec![
                    Constraint::Percentage(33),
                    Constraint::Percentage(33),
                    Constraint::Percentage(34),
                ])
                .split(paragraph_layout[0]);
            let bytes_overview_layout = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(vec![Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(outer_layout[2]);

            render_main_page_details(frame, &outer_layout);
            render_overview_metrics(app, frame, &inner_layout);
            render_overview_bytes_data(app, frame, &bytes_overview_layout);
            render_endpoint_table(app, frame, outer_layout[3]);
            render_clickhouse_sync_table(app, frame, outer_layout[5]);
            render_streaming_functions_messages_table(app, frame, outer_layout[6]);
        }
        State::PathDetails(state) => {
            let outer_layout = Layout::default()
                .direction(Direction::Vertical)
                .constraints(vec![
                    Constraint::Max(2),
                    Constraint::Min(3),
                    Constraint::Min(3),
                    Constraint::Fill(89),
                    Constraint::Max(3),
                ])
                .split(frame.size());

            let body_layout = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(vec![Constraint::Fill(44), Constraint::Percentage(56)])
                .split(outer_layout[3]);

            let chart_layout = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(vec![Constraint::Percentage(10), Constraint::Percentage(90)])
                .split(body_layout[1]);

            let top_row_data_layout = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(vec![Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(outer_layout[1]);

            let bottom_row_data = Layout::default()
                .direction(Direction::Horizontal)
                .constraints(vec![Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(outer_layout[2]);

            render_path_overview_data(&*app, frame, &top_row_data_layout, &bottom_row_data, state);
            render_path_page_details(frame, &outer_layout, state.clone());

            let scale_layout = Layout::default()
                .direction(Direction::Vertical)
                .constraints(vec![
                    Constraint::Min(2),
                    Constraint::Percentage(47),
                    Constraint::Min(2),
                    Constraint::Percentage(47),
                    Constraint::Min(2),
                ])
                .split(chart_layout[0]);

            render_sparkline_chart(&*app, frame, &chart_layout, &scale_layout, state);
            render_bar_chart(app, frame, &body_layout);
        }
    }
}

fn render_endpoint_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    match &app.table_state {
        TableState::Endpoint => render_active_endpoint_table(app, frame, layout),

        _ => render_passive_endpoint_table(app, frame, layout),
    }
}

fn render_active_endpoint_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    let mut rows: Vec<Row> = vec![];

    for x in &app.overview_data.summary {
        rows.push(
            if *app
                .paths_data
                .path_requests_per_sec
                .get(&x.path)
                .unwrap_or(&0.0)
                > 0.0
            {
                Row::new(vec![
                    format!("{}", x.path.to_string()),
                    format!(
                        "{}",
                        ((((x.latency_sum / x.request_count) * 1000.0) * 1000.0).round() / 1000.0)
                            .to_string()
                    ),
                    format!(
                        "{}",
                        (((x.request_count * 1000.0).round()) / 1000.0).to_string()
                    ),
                    format!(
                        "{}",
                        app.kafka_clikhouse_sync_metrics
                            .kafka_messages_in_total
                            .get(&x.path)
                            .unwrap_or(&("".to_string(), 0.0))
                            .1
                    ),
                ])
                .bold()
                .magenta()
            } else {
                Row::new(vec![
                    format!("{}", x.path.to_string()),
                    format!(
                        "{}",
                        ((((x.latency_sum / x.request_count) * 1000.0) * 1000.0).round() / 1000.0)
                            .to_string()
                    ),
                    format!(
                        "{}",
                        (((x.request_count * 1000.0).round()) / 1000.0).to_string()
                    ),
                    format!(
                        "{}",
                        app.kafka_clikhouse_sync_metrics
                            .kafka_messages_in_total
                            .get(&x.path)
                            .unwrap_or(&("".to_string(), 0.0))
                            .1
                    ),
                ])
                .white()
                .bold()
            },
        )
    }

    let widths = [
        Constraint::Fill(22),
        Constraint::Fill(15),
        Constraint::Fill(20),
        Constraint::Fill(25),
    ];
    let mut table_state = ratatui::widgets::TableState::default();
    table_state.select(Some(app.table_scroll_data.endpoint_starting_row));

    let table = Table::new(rows, widths)
        .widths(widths)
        .column_spacing(1)
        .style(Style::new().white())
        .header(
            Row::new(ENDPOINT_TABLE_COLUMNS)
                .style(Style::new().bold())
                .bottom_margin(1)
                .underlined()
                .top_margin(1),
        )
        .block(
            Block::bordered()
                .title(ENDPOINT_TABLE_TITLE)
                .bold()
                .border_style(Style::new().light_blue())
                .title_style(Style::new().white()),
        )
        .highlight_style(Style::new().reversed())
        .highlight_symbol(">>");

    frame.render_stateful_widget(table, layout, &mut table_state)
}

fn render_passive_endpoint_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    let mut rows: Vec<Row> = vec![];

    for x in &app.overview_data.summary {
        rows.push(
            if *app
                .paths_data
                .path_requests_per_sec
                .get(&x.path)
                .unwrap_or(&0.0)
                > 0.0
            {
                Row::new(vec![
                    format!("{}", x.path.to_string()),
                    format!(
                        "{}",
                        ((((x.latency_sum / x.request_count) * 1000.0) * 1000.0).round() / 1000.0)
                            .to_string()
                    ),
                    format!(
                        "{}",
                        (((x.request_count * 1000.0).round()) / 1000.0).to_string()
                    ),
                    format!(
                        "{}",
                        app.kafka_clikhouse_sync_metrics
                            .kafka_messages_in_total
                            .get(&x.path)
                            .unwrap_or(&("".to_string(), 0.0))
                            .1
                    ),
                ])
                .not_bold()
                .magenta()
            } else {
                Row::new(vec![
                    format!("{}", x.path.to_string()),
                    format!(
                        "{}",
                        ((((x.latency_sum / x.request_count) * 1000.0) * 1000.0).round() / 1000.0)
                            .to_string()
                    ),
                    format!(
                        "{}",
                        (((x.request_count * 1000.0).round()) / 1000.0).to_string()
                    ),
                    format!(
                        "{}",
                        app.kafka_clikhouse_sync_metrics
                            .kafka_messages_in_total
                            .get(&x.path)
                            .unwrap_or(&("".to_string(), 0.0))
                            .1
                    ),
                ])
                .white()
                .not_bold()
            },
        )
    }

    let widths = [
        Constraint::Fill(22),
        Constraint::Fill(15),
        Constraint::Fill(20),
        Constraint::Fill(25),
    ];
    let mut table_state = ratatui::widgets::TableState::default();
    table_state.select(Some(app.table_scroll_data.endpoint_starting_row));

    let table = Table::new(rows, widths)
        .widths(widths)
        .column_spacing(1)
        .style(Style::new().white())
        .header(
            Row::new(ENDPOINT_TABLE_COLUMNS)
                .style(Style::new().bold())
                .bottom_margin(1)
                .underlined()
                .top_margin(1),
        )
        .block(
            Block::bordered()
                .title(ENDPOINT_TABLE_TITLE)
                .bold()
                .title_style(Style::new().white())
                .border_style(Style::new().dark_gray()),
        );

    frame.render_widget(table, layout)
}

fn render_clickhouse_sync_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    match app.table_state {
        TableState::Kafka => render_active_clickhouse_sync_table(app, frame, layout),
        _ => render_passive_clickhouse_sync_table(app, frame, layout),
    }
}

fn render_passive_clickhouse_sync_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    let mut rows: Vec<Row> = vec![];

    let mut sorted_messages: Vec<_> = app
        .kafka_clikhouse_sync_metrics
        .kafka_messages_out_total
        .iter()
        .collect();
    sorted_messages.sort_by_key(|a| a.0.to_lowercase());

    for item in &sorted_messages {
        rows.push(
            Row::new(vec![
                format!("{}", item.0.to_string()),
                format!("{}", item.2),
                format!("{}", {
                    let mut lag: Option<f64> = None;
                    for value in &app.kafka_clikhouse_sync_metrics.kafka_messages_in_total {
                        if table_equals_path(value.0.clone(), item.0.clone()) {
                            lag = Some(value.1 .1 - item.2);
                            break;
                        }
                    }
                    match lag {
                        Some(value) => value.to_string(),
                        None => "NA".to_string(),
                    }
                }),
                format!(
                    "{}",
                    app.kafka_clikhouse_sync_metrics
                        .kafka_messages_out_per_sec
                        .get(&item.0)
                        .unwrap_or(&("".to_string(), 0.0))
                        .1
                ),
                format!(
                    "{}",
                    format_bytes(
                        *app.kafka_clikhouse_sync_metrics
                            .kafka_bytes_out_per_sec
                            .get(&item.0)
                            .unwrap_or(&0) as f64
                    )
                ),
            ])
            .not_bold()
            .white(),
        )
    }

    let widths = [
        Constraint::Percentage(25),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
    ];

    let table = Table::new(rows, widths)
        .widths(widths)
        .column_spacing(1)
        .style(Style::new().white())
        .header(
            Row::new(KAFKA_CLICKHOUSE_SYNC_TABLE_COLUMNS)
                .style(Style::new().bold())
                .bottom_margin(1)
                .underlined()
                .top_margin(1),
        )
        .block(
            Block::bordered()
                .title(KAFKA_CLICKHOUSE_SYNC_TABLE_TITLE)
                .bold()
                .title_style(Style::new().white())
                .border_style(Style::new().dark_gray()),
        );

    frame.render_widget(table, layout)
}

fn render_active_clickhouse_sync_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    let mut rows: Vec<Row> = vec![];

    let mut sorted_messages: Vec<_> = app
        .kafka_clikhouse_sync_metrics
        .kafka_messages_out_total
        .iter()
        .collect();
    sorted_messages.sort_by_key(|a| a.0.to_lowercase());

    for item in &sorted_messages {
        rows.push(
            Row::new(vec![
                format!("{}", item.0.to_string()),
                format!("{}", item.2),
                format!("{}", {
                    let mut lag: Option<f64> = None;
                    for value in &app.kafka_clikhouse_sync_metrics.kafka_messages_in_total {
                        if table_equals_path(value.0.clone(), item.0.clone()) {
                            lag = Some(value.1 .1 - item.2);
                            break;
                        }
                    }
                    match lag {
                        Some(value) => value.to_string(),
                        None => "NA".to_string(),
                    }
                }),
                format!(
                    "{}",
                    app.kafka_clikhouse_sync_metrics
                        .kafka_messages_out_per_sec
                        .get(&item.0)
                        .unwrap_or(&("".to_string(), 0.0))
                        .1
                ),
                format!(
                    "{}",
                    format_bytes(
                        *app.kafka_clikhouse_sync_metrics
                            .kafka_bytes_out_per_sec
                            .get(&item.0)
                            .unwrap_or(&0) as f64
                    )
                ),
            ])
            .bold()
            .white(),
        )
    }

    let widths = [
        Constraint::Percentage(25),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
        Constraint::Percentage(18),
    ];
    let mut table_state = ratatui::widgets::TableState::default();
    table_state.select(Some(app.table_scroll_data.kafka_starting_row));

    let table = Table::new(rows, widths)
        .widths(widths)
        .column_spacing(1)
        .style(Style::new().white())
        .header(
            Row::new(KAFKA_CLICKHOUSE_SYNC_TABLE_COLUMNS)
                .style(Style::new().bold())
                .bottom_margin(1)
                .underlined()
                .top_margin(0),
        )
        .block(
            Block::bordered()
                .title(KAFKA_CLICKHOUSE_SYNC_TABLE_TITLE)
                .bold()
                .border_style(Style::new().light_blue())
                .title_style(Style::new().white()),
        )
        .highlight_style(Style::new().reversed())
        .highlight_symbol(">>");

    frame.render_stateful_widget(table, layout, &mut table_state)
}

fn render_streaming_functions_messages_table(app: &mut App, frame: &mut Frame, layout: Rect) {
    match app.table_state {
        TableState::StreamingFunction => {
            render_active_streaming_functions_messages_table(app, frame, layout);
        }
        _ => {
            render_passive_streaming_functions_messages_table(app, frame, layout);
        }
    }
}

fn render_active_streaming_functions_messages_table(
    app: &mut App,
    frame: &mut Frame,
    layout: Rect,
) {
    let mut rows: Vec<Row> = vec![];

    let mut sorted_messages: Vec<_> = app
        .streaming_functions_metrics
        .streaming_functions_in
        .iter()
        .collect();
    sorted_messages.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    for item in &sorted_messages {
        rows.push(
            Row::new(vec![
                format!("{}", item.0.to_string()),
                format!("{}", item.1),
                format!(
                    "{}",
                    app.streaming_functions_metrics
                        .streaming_functions_in_per_sec
                        .get(item.0)
                        .unwrap_or(&0.0)
                ),
                format!(
                    "{}",
                    app.streaming_functions_metrics
                        .streaming_functions_out
                        .get(item.0)
                        .unwrap_or(&0.0)
                ),
                format!(
                    "{}",
                    app.streaming_functions_metrics
                        .streaming_functions_out_per_sec
                        .get(item.0)
                        .unwrap_or(&0.0)
                ),
                format!(
                    "{}",
                    format_bytes(
                        *app.streaming_functions_metrics
                            .streaming_functions_bytes_per_sec
                            .get(item.0)
                            .unwrap_or(&0) as f64
                    )
                ),
            ])
            .bold()
            .white(),
        )
    }

    let widths = [
        Constraint::Percentage(40),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
    ];
    let mut table_state = ratatui::widgets::TableState::default();
    table_state.select(Some(
        app.table_scroll_data.streaming_functions_table_starting_row,
    ));

    let table = Table::new(rows, widths)
        .widths(widths)
        .column_spacing(1)
        .style(Style::new().white())
        .header(
            Row::new(STREAMING_FUNCTIONS_KAFKA_TABLE_COLUMNS)
                .style(Style::new().bold())
                .bottom_margin(1)
                .underlined()
                .top_margin(1),
        )
        .block(
            Block::bordered()
                .title(STREAMING_FUNCTIONS_KAFKA_TABLE_TITLE)
                .bold()
                .border_style(Style::new().light_blue())
                .title_style(Style::new().white()),
        )
        .highlight_style(Style::new().reversed())
        .highlight_symbol(">>");

    frame.render_stateful_widget(table, layout, &mut table_state)
}

fn render_passive_streaming_functions_messages_table(
    app: &mut App,
    frame: &mut Frame,
    layout: Rect,
) {
    let mut rows: Vec<Row> = vec![];

    let mut sorted_messages: Vec<_> = app
        .streaming_functions_metrics
        .streaming_functions_in
        .iter()
        .collect();
    sorted_messages.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    for item in &sorted_messages {
        rows.push(
            Row::new(vec![
                format!("{}", item.0.to_string()),
                format!("{}", item.1),
                format!(
                    "{}",
                    app.streaming_functions_metrics
                        .streaming_functions_in_per_sec
                        .get(item.0)
                        .unwrap_or(&0.0)
                ),
                format!(
                    "{}",
                    app.streaming_functions_metrics
                        .streaming_functions_out
                        .get(item.0)
                        .unwrap_or(&0.0)
                ),
                format!(
                    "{}",
                    app.streaming_functions_metrics
                        .streaming_functions_out_per_sec
                        .get(item.0)
                        .unwrap_or(&0.0)
                ),
                format!(
                    "{}",
                    format_bytes(
                        *app.streaming_functions_metrics
                            .streaming_functions_bytes_per_sec
                            .get(item.0)
                            .unwrap_or(&0) as f64
                    )
                ),
            ])
            .not_bold()
            .white(),
        )
    }

    let widths = [
        Constraint::Percentage(40),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
        Constraint::Percentage(12),
    ];
    let mut table_state = ratatui::widgets::TableState::default();
    table_state.select(Some(app.table_scroll_data.kafka_starting_row));

    let table = Table::new(rows, widths)
        .widths(widths)
        .column_spacing(1)
        .style(Style::new().white())
        .header(
            Row::new(STREAMING_FUNCTIONS_KAFKA_TABLE_COLUMNS)
                .style(Style::new().bold())
                .bottom_margin(1)
                .underlined()
                .top_margin(1),
        )
        .block(
            Block::bordered()
                .title(STREAMING_FUNCTIONS_KAFKA_TABLE_TITLE)
                .bold()
                .title_style(Style::new().white())
                .border_style(Style::new().dark_gray()),
        );

    frame.render_widget(table, layout)
}

fn table_equals_path(path: String, table: String) -> bool {
    let mut path_vec: Vec<&str> = path.split(['/', '.']).collect();
    path_vec.remove(0);
    let table_vec: Vec<&str> = table.split('_').collect();
    table_vec == path_vec
}

fn render_overview_metrics(app: &mut App, frame: &mut Frame, layout: &Rc<[Rect]>) {
    let average_lat_block = Block::new()
        .title("AVERAGE LATENCY")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray())
        .borders(Borders::ALL);

    let average_latency_paragraph = Paragraph::new(format!(
        "{} ms",
        (app.overview_data.average * 1000.0).round() / 1000.0
    ))
    .left_aligned()
    .block(average_lat_block)
    .style(Style::new().white());

    let total_req_block = Block::new()
        .title("TOTAL # OF REQUESTS")
        .title_alignment(Alignment::Left)
        .borders(Borders::ALL)
        .bold()
        .padding(Padding::horizontal(2))
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());

    let total_req_paragraph = Paragraph::new(app.overview_data.total_requests.to_string())
        .left_aligned()
        .block(total_req_block)
        .style(Style::new().white());

    let req_per_sec_block = Block::new()
        .title("REQUESTS PER SECOND")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::ALL)
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());
    let req_per_sec_paragraph = Paragraph::new(app.overview_data.requests_per_sec.to_string())
        .left_aligned()
        .block(req_per_sec_block)
        .style(Style::new().white());

    frame.render_widget(average_latency_paragraph, layout[0]);
    frame.render_widget(total_req_paragraph, layout[1]);
    frame.render_widget(req_per_sec_paragraph, layout[2]);
}

fn render_overview_bytes_data(app: &mut App, frame: &mut Frame, layout: &Rc<[Rect]>) {
    let bytes_in_per_sec_block = Block::new()
        .title("DATA IN")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::ALL)
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());

    let bytes_out_per_sec_block = Block::new()
        .title("DATA OUT")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::ALL)
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());

    let bytes_in_per_sec_paragraph = Paragraph::new(format_bytes(
        app.overview_data.main_bytes_data.bytes_in_per_sec as f64,
    ))
    .left_aligned()
    .block(bytes_in_per_sec_block)
    .style(Style::new().white());

    let bytes_out_per_sec_paragraph = Paragraph::new(format_bytes(
        app.overview_data.main_bytes_data.bytes_out_per_sec as f64,
    ))
    .left_aligned()
    .block(bytes_out_per_sec_block)
    .style(Style::new().white());

    frame.render_widget(bytes_in_per_sec_paragraph, layout[0]);
    frame.render_widget(bytes_out_per_sec_paragraph, layout[1]);
}

fn render_main_page_details(frame: &mut Frame, layout: &Rc<[Rect]>) {
    let info_footer = Paragraph::new(Line::from(INFO_TEXT).white())
        .centered()
        .block(
            Block::bordered()
                .border_type(BorderType::Plain)
                .border_style(Style::new().fg(Color::DarkGray)),
        );

    let endpoint_block = Block::new()
        .title("ENDPOINT METRICS")
        .title_alignment(Alignment::Center)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::TOP)
        .white();

    let kafka_block = Block::new()
        .title("KAFKA METRICS")
        .title_alignment(Alignment::Center)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::TOP)
        .white();

    frame.render_widget(endpoint_block, layout[0]);
    frame.render_widget(kafka_block, layout[4]);
    frame.render_widget(info_footer, layout[7]);
}

fn render_path_overview_data(
    app: &App,
    frame: &mut Frame,
    top_layout: &Rc<[Rect]>,
    bottom_layout: &Rc<[Rect]>,
    state: &String,
) {
    let average_latency_block = Block::new()
        .title("AVERAGE LATENCY")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::ALL)
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());

    let average_latency_paragraph = Paragraph::new(format!(
        "{} ms",
        (((app.overview_data.summary[app.table_scroll_data.endpoint_starting_row].latency_sum
            / app.overview_data.summary[app.table_scroll_data.endpoint_starting_row]
                .request_count)
            * 1000000.0)
            .round())
            / 1000.0
    ))
    .left_aligned()
    .block(average_latency_block)
    .style(Style::new().white());

    let request_count_block = Block::new()
        .title("# OF REQUESTS")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::ALL)
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());

    let request_count_paragraph = Paragraph::new(
        app.overview_data.summary[app.table_scroll_data.endpoint_starting_row]
            .request_count
            .to_string(),
    )
    .left_aligned()
    .block(request_count_block)
    .style(Style::new().white());

    let path_req_per_sec_block = Block::new()
        .title("REQUESTS PER SECOND")
        .title_alignment(Alignment::Left)
        .bold()
        .padding(Padding::horizontal(2))
        .borders(Borders::ALL)
        .title_style(Style::new().white())
        .border_style(Style::new().dark_gray());
    let path_req_per_sec_paragraph = Paragraph::new(
        app.paths_data
            .path_requests_per_sec
            .get(state)
            .unwrap_or(&0.0)
            .to_string(),
    )
    .left_aligned()
    .block(path_req_per_sec_block)
    .style(Style::new().white());

    if state.starts_with("ingest") {
        let bytes_in_per_sec_block = Block::new()
            .title("DATA IN")
            .title_alignment(Alignment::Left)
            .bold()
            .padding(Padding::horizontal(2))
            .borders(Borders::ALL)
            .title_style(Style::new().white())
            .border_style(Style::new().dark_gray());

        let bytes_in_per_sec_paragraph = Paragraph::new(format_bytes(
            (*app
                .paths_data
                .parsed_bytes_data
                .path_bytes_in_per_sec_vec
                .get(state)
                .unwrap_or(&0)) as f64,
        ))
        .left_aligned()
        .block(bytes_in_per_sec_block)
        .style(Style::new().white());

        frame.render_widget(bytes_in_per_sec_paragraph, bottom_layout[1]);
    } else {
        let bytes_in_per_sec_block = Block::new()
            .title("DATA OUT")
            .title_alignment(Alignment::Left)
            .bold()
            .padding(Padding::horizontal(2))
            .borders(Borders::ALL)
            .title_style(Style::new().white())
            .border_style(Style::new().dark_gray());

        let bytes_in_per_sec_paragraph = Paragraph::new(format_bytes(
            *app.paths_data
                .parsed_bytes_data
                .path_bytes_out_per_sec_vec
                .get(state)
                .unwrap_or(&0) as f64,
        ))
        .left_aligned()
        .block(bytes_in_per_sec_block)
        .style(Style::new().white());
        frame.render_widget(bytes_in_per_sec_paragraph, bottom_layout[1]);
    }

    frame.render_widget(average_latency_paragraph, top_layout[0]);
    frame.render_widget(request_count_paragraph, top_layout[1]);
    frame.render_widget(path_req_per_sec_paragraph, bottom_layout[0]);
}

fn render_path_page_details(frame: &mut Frame, layout: &Rc<[Rect]>, state: String) {
    let title = Block::new()
        .title(state.to_uppercase())
        .title_alignment(Alignment::Center)
        .bold()
        .borders(Borders::TOP)
        .white();

    let info_footer = Paragraph::new(Line::from(PATH_INFO_TEXT).white())
        .centered()
        .block(
            Block::bordered()
                .border_type(BorderType::Plain)
                .border_style(Style::new().fg(Color::DarkGray)),
        );

    frame.render_widget(title, layout[0]);
    frame.render_widget(info_footer, layout[4]);
}

fn render_bar_chart(app: &mut App, frame: &mut Frame, layout: &Rc<[Rect]>) {
    let mut chart_data_vec: Vec<Bar> = vec![];
    let bucket_data = app.paths_data.path_detailed_data.clone().unwrap();

    for each in bucket_data {
        if each.count > 0.0 {
            chart_data_vec.push(
                Bar::default()
                    .value(each.count as u64)
                    .label((each.less_than.to_string() + "s").into()),
            );
        } else {
            chart_data_vec.push(
                Bar::default()
                    .value(0)
                    .label(each.less_than.to_string().into()),
            );
        }
    }

    let bar_group = BarGroup::default().bars(&chart_data_vec);

    let bar_chart = BarChart::default()
        .block(
            Block::bordered()
                .title("# OF REQUESTS WITH LATENCY UNDER _ SEC")
                .bold()
                .title_alignment(Alignment::Left)
                .title_style(Style::new().white())
                .border_style(Style::new().dark_gray()),
        )
        .data(bar_group)
        .bar_width(1)
        .direction(Direction::Horizontal)
        .bar_style(Style::default().fg(Color::DarkGray))
        .value_style(Style::default().white().on_dark_gray().bold());

    frame.render_widget(bar_chart, layout[0]);
}
fn render_sparkline_chart(
    app: &App,
    frame: &mut Frame,
    chart_layout: &Rc<[Rect]>,
    scale_layout: &Rc<[Rect]>,
    state: &String,
) {
    let chart: Sparkline;
    let mut top_paragraph: Paragraph = Paragraph::new("0->");
    let mut middle_paragraph: Paragraph = Paragraph::new("0->");
    let mut bottom_paragraph: Paragraph = Paragraph::new("0->");

    if !app.paths_data.requests_per_sec_vec.contains_key(state) {
        chart = Sparkline::default()
            .block(Block::new().borders(Borders::NONE).title(format!(
                "REQUESTS PER SECOND OVER THE PAST {} SEC",
                {
                    if (app.viewport.width as f64 * 0.48) > 150.0 {
                        150
                    } else {
                        (app.viewport.width as f64 * 0.48) as usize
                    }
                }
            )))
            .data(&[0])
            .style(Style::default().fg(Color::White));
    } else {
        // This unwrap is safe because we know the key exists
        chart = Sparkline::default()
            .block(
                Block::new()
                    .borders(Borders::TOP | Borders::BOTTOM | Borders::RIGHT)
                    .title(format!("REQUESTS PER SECOND OVER THE PAST {} SEC", {
                        if (app.viewport.width as f64 * 0.48) > 150.0 {
                            150
                        } else {
                            (app.viewport.width as f64 * 0.48) as usize
                        }
                    }))
                    .title_alignment(Alignment::Left)
                    .bold()
                    .title_style(Style::new().white())
                    .border_style(Style::new().dark_gray()),
            )
            .data(match &app.paths_data.requests_per_sec_vec.get(state) {
                Some(v) => {
                    v.get(
                        ((app // This unwrap is safe because we know the key exists
                            .paths_data
                            .requests_per_sec_vec
                            .get(state)
                            .unwrap_or(&vec![0; 0])
                            .len() as f64)
                            - (app.viewport.width as f64 * 0.48))
                            as usize..,
                    )
                    .unwrap_or(&v[0..])
                }
                None => &[],
            })
            .style(Style::default().fg(Color::DarkGray));

        top_paragraph = Paragraph::new(
            Line::from(format!(
                "{}->",
                match &app.paths_data.requests_per_sec_vec.get(state) {
                    Some(v) => v
                        .get(
                            (app.paths_data
                                .requests_per_sec_vec
                                .get(state)
                                .unwrap_or(&vec![0; 0])
                                .len() as f64
                                - (app.viewport.width as f64 * 0.48))
                                as usize..
                        )
                        .unwrap_or(&v[0..])
                        .iter()
                        .max()
                        .unwrap_or(&0),
                    None => &0,
                }
            ))
            .white()
            .centered(),
        )
        .block(
            Block::new()
                .borders(Borders::LEFT | Borders::TOP)
                .border_style(Style::new().dark_gray()),
        );

        middle_paragraph = Paragraph::new(
            Line::from(format!(
                "{}->",
                match &app.paths_data.requests_per_sec_vec.get(state) {
                    Some(v) =>
                        v.get(
                            (app.paths_data
                                .requests_per_sec_vec
                                .get(state)
                                .unwrap_or(&vec![0; 0])
                                .len() as f64
                                - (app.viewport.width as f64 * 0.48))
                                as usize..
                        )
                        .unwrap_or(&v[0..])
                        .iter()
                        .max()
                        .unwrap_or(&0)
                            / 2,
                    None => 0,
                }
            ))
            .white(),
        )
        .block(
            Block::new()
                .borders(Borders::LEFT)
                .border_style(Style::new().dark_gray()),
        )
        .centered();

        bottom_paragraph = Paragraph::new(Line::from("0->").white()).centered().block(
            Block::new()
                .borders(Borders::BOTTOM | Borders::LEFT)
                .border_style(Style::new().dark_gray()),
        );
    }

    let border_block_one = Block::new()
        .borders(Borders::LEFT)
        .border_style(Style::new().dark_gray());
    let border_block_two = Block::new()
        .borders(Borders::LEFT)
        .border_style(Style::new().dark_gray());

    frame.render_widget(chart, chart_layout[1]);
    frame.render_widget(top_paragraph, scale_layout[0]);
    frame.render_widget(middle_paragraph, scale_layout[2]);
    frame.render_widget(bottom_paragraph, scale_layout[4]);
    frame.render_widget(border_block_one, scale_layout[1]);
    frame.render_widget(border_block_two, scale_layout[3]);
}

fn format_bytes(bytes: f64) -> String {
    if (bytes / 1000000000.0) > 1.0 {
        format!("{:.3} GB/s", (bytes / 1000000000.0))
            .trim()
            .to_string()
    } else if (bytes / 1000000.0) > 1.0 {
        format!("{:.3} MB/s", (bytes / 1000000.0))
            .trim()
            .to_string()
    } else if (bytes / 1000.0) > 1.0 {
        format!("{:.3} KB/s", (bytes / 1000.0)).trim().to_string()
    } else {
        format!("{bytes:3} B/s").trim().to_string()
    }
}
