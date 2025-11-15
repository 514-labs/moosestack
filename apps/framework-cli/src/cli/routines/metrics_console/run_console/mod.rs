use app::BytesMetricsData;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use std::io;
use std::time;

mod app;
mod client;
mod event;
mod handler;
mod tui;
mod ui;

use app::App;
use client::ParsedMetricsData;
use event::Event;
use handler::handle_key_events;

pub async fn run_console() -> app::AppResult<()> {
    // Create an application.
    let mut app = App::new();

    // Initialize the terminal user interface.
    let backend = CrosstermBackend::new(io::stderr());
    let terminal = Terminal::new(backend)?;
    let events = event::EventHandler::new(250);
    let mut tui = tui::Tui::new(terminal, events);
    tui.init()?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<ParsedMetricsData>(10);

    tokio::spawn(async move {
        loop {
            let parsed_data = client::getting_metrics_data().await.unwrap();
            let _ = tx.send(parsed_data).await;
            tokio::time::sleep(time::Duration::from_millis(1000)).await;
        }
    });

    // Start the main loop.
    while app.running {
        tokio::select! {
            received = rx.recv() => {
                if let Some(v) = received {
                    app.per_sec_metrics(v.total_requests, &v.paths_data_vec, BytesMetricsData {path_bytes_hashmap: v.paths_bytes_hashmap.clone(), total_bytes_in: v.total_bytes_in, total_bytes_out: v.total_bytes_out, kafka_bytes_out_total: v.kafka_bytes_out_total.clone(), streaming_functions_bytes: v.streaming_functions_bytes.clone()}, &v.kafka_messages_out_total, &v.streaming_functions_in, &v.streaming_functions_out);
                    app.set_metrics(v);
                };
            }
            // Handle events.
            event = tui.events.next() => { match event?{
                    Event::Tick => app.tick(),
                    Event::Key(key_event) => handle_key_events(key_event, &mut app).await?,
                }
            }
        }

        // Render the user interface.
        tui.draw(&mut app)?;
    }

    // Exit the user interface.
    tui.exit()?;
    Ok(())
}
