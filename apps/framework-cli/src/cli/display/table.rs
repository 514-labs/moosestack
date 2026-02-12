//! Table display functionality for formatted output.
//!
//! This module provides utilities for displaying data in formatted tables
//! with consistent styling and layout.

use super::context::{tui_channel, DisplayMessage};
use crate::utilities::constants::SUPPRESS_DISPLAY;
use comfy_table::{modifiers::UTF8_ROUND_CORNERS, presets::UTF8_FULL, ContentArrangement, Table};
use std::sync::atomic::Ordering;

/// Displays a formatted table with headers and data rows.
///
/// Creates a visually appealing table using UTF-8 characters with rounded corners
/// and full borders. The table automatically adjusts column widths based on content.
///
/// # Arguments
///
/// * `title` - The title to display above the table
/// * `headers` - Column headers for the table
/// * `rows` - Data rows, where each row is a vector of column values
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::table::show_table;
/// show_table(
///     "User Data".to_string(),
///     vec!["ID".to_string(), "Name".to_string(), "Email".to_string()],
///     vec![
///         vec!["1".to_string(), "Alice".to_string(), "alice@example.com".to_string()],
///         vec!["2".to_string(), "Bob".to_string(), "bob@example.com".to_string()],
///     ]
/// );
/// ```
pub fn show_table(title: String, headers: Vec<String>, rows: Vec<Vec<String>>) {
    // Check for TUI context first - route to TUI if available
    if let Some(sender) = tui_channel() {
        sender.send(DisplayMessage::Table {
            title,
            headers,
            rows,
        });
        return;
    }

    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .apply_modifier(UTF8_ROUND_CORNERS);
    table.set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(headers);

    for row in rows {
        table.add_row(row);
    }

    if !SUPPRESS_DISPLAY.load(Ordering::Relaxed) {
        println!("{title}\n{table}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_show_table_doesnt_panic() {
        let title = "Test Table".to_string();
        let headers = vec!["Col1".to_string(), "Col2".to_string()];
        let rows = vec![
            vec!["A".to_string(), "B".to_string()],
            vec!["C".to_string(), "D".to_string()],
        ];

        // This should not panic
        show_table(title, headers, rows);
    }

    #[test]
    fn test_show_table_with_empty_rows() {
        let title = "Empty Table".to_string();
        let headers = vec!["Header1".to_string(), "Header2".to_string()];
        let rows: Vec<Vec<String>> = vec![];

        // This should not panic
        show_table(title, headers, rows);
    }

    #[test]
    fn test_show_table_with_unicode() {
        let title = "Unicode Table".to_string();
        let headers = vec!["名前".to_string(), "年齢".to_string()];
        let rows = vec![
            vec!["太郎".to_string(), "25".to_string()],
            vec!["花子".to_string(), "30".to_string()],
        ];

        // This should not panic
        show_table(title, headers, rows);
    }
}
