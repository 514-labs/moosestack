//! Infrastructure change display functionality.
//!
//! This module handles the display of infrastructure changes including
//! OLAP changes, streaming changes, process changes, and API changes.
//! It provides specialized formatting for different types of infrastructure
//! modifications.
//!
//! ## Key Components
//!
//! ### Display Functions
//! - `infra_added()`, `infra_removed()`, `infra_updated()`: Core display functions for infrastructure changes
//! - `infra_added_detailed()`, `infra_removed_detailed()`, `infra_updated_detailed()`: Multi-line display variants
//! - `show_olap_changes()`, `show_streaming_changes()`, `show_process_changes()`, `show_api_changes()`: Category-specific change handlers
//!
//! ### Helper Functions
//! - `format_column_type()`: Formats column types with enum value display
//! - `format_column_attributes()`: Formats nullability and default values (DRY principle)
//! - `format_column_constraints()`: Formats column constraints like primary key and unique (DRY principle)
//! - `format_table_display()`: Comprehensive table formatting for display
//!
//! ### Macros
//! - `handle_standard_change!`: Reduces code duplication for standard Added/Removed/Updated patterns
//!
//! ## Design Principles
//!
//! This module follows the DRY (Don't Repeat Yourself) principle by extracting common
//! formatting patterns into reusable helper functions and macros. The refactoring ensures
//! consistent display formatting while reducing code duplication and maintenance overhead.

use super::terminal::{write_styled_line, StyledText, ACTION_WIDTH};
use crate::framework::core::{
    infrastructure::table::{ColumnType, EnumValue},
    infrastructure_map::{
        ApiChange, Change, OlapChange, ProcessChange, StreamingChange, TableChange,
    },
    plan::InfraPlan,
};
use crossterm::{execute, style::Print};
use log::info;

/// Create the detail indentation string at compile time
/// Computed from ACTION_WIDTH (15) + 3 spaces:
/// - ACTION_WIDTH spaces for the action column
/// - 1 space after the action symbol (e.g., "+", "-", "~")  
/// - 2 spaces for additional indentation of detail lines
///   Total: 18 spaces for proper alignment
const DETAIL_INDENT: &str = {
    const INDENT_BYTES: [u8; ACTION_WIDTH + 3] = [b' '; ACTION_WIDTH + 3];
    // This is safe because we know all bytes are spaces (0x20), which are valid UTF-8
    match std::str::from_utf8(&INDENT_BYTES) {
        Ok(s) => s,
        Err(_) => panic!("Invalid UTF-8 in DETAIL_INDENT"),
    }
};

/// Helper function to write detail lines with proper indentation
fn write_detail_lines(details: &[String]) {
    let mut stdout = std::io::stdout();
    for detail in details {
        execute!(stdout, Print(DETAIL_INDENT), Print(detail), Print("\n"))
            .expect("failed to write detail to terminal");
    }
}

/// Macro to handle common change patterns for infrastructure components.
///
/// This macro reduces code duplication by providing a standard pattern
/// for handling Added, Removed, and Updated changes for infrastructure
/// components that implement `expanded_display()` and `short_display()` methods.
///
/// # Arguments
///
/// * `$change` - The change enum to match against
/// * `$change_type` - The specific change type (e.g., `Change`)
///
/// # Examples
///
/// ```rust
/// handle_standard_change!(change, Change, {
///     Added(infra) => infra_added(&infra.expanded_display()),
///     Removed(infra) => infra_removed(&infra.short_display()),
///     Updated { before, after: _ } => infra_updated(&before.expanded_display())
/// });
/// ```
macro_rules! handle_standard_change {
    ($change:expr) => {
        match $change {
            Change::Added(infra) => {
                infra_added(&infra.expanded_display());
            }
            Change::Removed(infra) => {
                infra_removed(&infra.short_display());
            }
            Change::Updated { before, after: _ } => {
                infra_updated(&before.expanded_display());
            }
        }
    };
}

/// Formats a column type for display, showing enum values if it's an enum
fn format_column_type(col_type: &ColumnType) -> String {
    match col_type {
        ColumnType::Enum(data_enum) => {
            let values = data_enum
                .values
                .iter()
                .map(|member| match &member.value {
                    EnumValue::Int(i) => format!("{}={}", member.name, i),
                    EnumValue::String(s) => format!("{}='{}'", member.name, s),
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("Enum<{}>[{}]", data_enum.name, values)
        }
        _ => col_type.to_string(),
    }
}

/// Formats column nullability and default value attributes.
///
/// This helper function handles the common pattern of formatting
/// nullability (NOT NULL/NULLABLE) and default values for database columns.
///
/// # Arguments
///
/// * `required` - Whether the column is required (NOT NULL)
/// * `default` - Optional default value for the column
///
/// # Returns
///
/// A formatted string containing nullability and default value information
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::format_column_attributes;
/// let attrs = format_column_attributes(true, Some("'test'".to_string()));
/// assert_eq!(attrs, " NOT NULL DEFAULT='test'");
/// ```
fn format_column_attributes(required: bool, default: Option<&String>) -> String {
    let mut result = String::new();

    // Add nullability
    if required {
        result.push_str(" NOT NULL");
    } else {
        result.push_str(" NULLABLE");
    }

    // Add default value
    if let Some(default_val) = default {
        result.push_str(&format!(" DEFAULT={}", default_val));
    }

    result
}

/// Formats column constraints into a readable string.
///
/// This helper function handles the common pattern of formatting
/// column constraints like primary key and unique constraints.
///
/// # Arguments
///
/// * `primary_key` - Whether the column is a primary key
/// * `unique` - Whether the column has a unique constraint
///
/// # Returns
///
/// An optional formatted string containing constraint information
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::format_column_constraints;
/// let constraints = format_column_constraints(true, false);
/// assert_eq!(constraints, Some(" [primary key]".to_string()));
/// ```
fn format_column_constraints(primary_key: bool, unique: bool) -> Option<String> {
    let mut constraints = Vec::new();
    if primary_key {
        constraints.push("primary key");
    }
    if unique {
        constraints.push("unique");
    }

    if constraints.is_empty() {
        None
    } else {
        Some(format!(" [{}]", constraints.join(", ")))
    }
}

/// Formats a table for display with columns shown vertically
/// Returns a tuple of (title, details) for use with detailed display functions
fn format_table_display(
    table: &crate::framework::core::infrastructure::table::Table,
) -> (String, Vec<String>) {
    let mut details = Vec::new();

    // Table header
    let title = if let Some(ref version) = table.version {
        format!("Table: {} (Version: {})", table.name, version)
    } else {
        format!("Table: {}", table.name)
    };

    // Columns section
    details.push("Columns:".to_string());
    for column in &table.columns {
        let mut col_str = format!(
            "  {}: {}",
            column.name,
            format_column_type(&column.data_type)
        );

        // Add nullability and default value
        col_str.push_str(&format_column_attributes(
            column.required,
            column.default.as_ref(),
        ));

        // Add constraints
        if let Some(constraints_str) = format_column_constraints(column.primary_key, column.unique)
        {
            col_str.push_str(&constraints_str);
        }

        details.push(col_str);
    }

    // Order by section (if present)
    if !table.order_by.is_empty() {
        details.push(format!("Order by: {}", table.order_by));
    }

    // Engine section (if present)
    if let Some(ref engine) = table.engine {
        details.push(format!("Engine: {}", Into::<String>::into(engine.clone())));
    }

    (title, details)
}

/// Displays a message about infrastructure being added.
///
/// Uses green styling with a "+" prefix to indicate addition.
/// The message is both displayed to the terminal and logged.
///
/// # Arguments
///
/// * `message` - The message describing the added infrastructure
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::infra_added;
/// infra_added("Database table 'users' created");
/// ```
pub fn infra_added(message: &str) {
    let styled_text = StyledText::from_str("+ ").green();
    write_styled_line(&styled_text, message).expect("failed to write message to terminal");
    info!("+ {}", message.trim());
}

/// Displays a detailed message about infrastructure being added.
///
/// Uses green styling with a "+" prefix for the title, followed by
/// indented detail lines. This is useful for multi-line displays.
///
/// # Arguments
///
/// * `title` - The title message for the added infrastructure
/// * `details` - A slice of detail strings to display with indentation
pub fn infra_added_detailed(title: &str, details: &[String]) {
    infra_added(title);
    write_detail_lines(details);

    // Log the full message
    info!("+ {} {}", title.trim(), details.join(" "));
}

/// Displays a message about infrastructure being removed.
///
/// Uses red styling with a "-" prefix to indicate removal.
/// The message is both displayed to the terminal and logged.
///
/// # Arguments
///
/// * `message` - The message describing the removed infrastructure
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::infra_removed;
/// infra_removed("Database table 'temp_data' dropped");
/// ```
pub fn infra_removed(message: &str) {
    let styled_text = StyledText::from_str("- ").red();
    write_styled_line(&styled_text, message).expect("failed to write message to terminal");
    info!("- {}", message.trim());
}

/// Displays a detailed message about infrastructure being removed.
///
/// Uses red styling with a "-" prefix for the title, followed by
/// indented detail lines. This is useful for multi-line displays.
///
/// # Arguments
///
/// * `title` - The title message for the removed infrastructure
/// * `details` - A slice of detail strings to display with indentation
pub fn infra_removed_detailed(title: &str, details: &[String]) {
    infra_removed(title);
    write_detail_lines(details);

    // Log the full message
    info!("- {} {}", title.trim(), details.join(" "));
}

/// Displays a message about infrastructure being updated.
///
/// Uses yellow styling with a "~" prefix to indicate modification.
/// The message is both displayed to the terminal and logged.
///
/// # Arguments
///
/// * `message` - The message describing the updated infrastructure
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::infra_updated;
/// infra_updated("Database table 'users' schema modified");
/// ```
pub fn infra_updated(message: &str) {
    let styled_text = StyledText::from_str("~ ").yellow();
    write_styled_line(&styled_text, message).expect("failed to write message to terminal");
    info!("~ {}", message.trim());
}

/// Displays a multi-line message about infrastructure being updated with detailed formatting.
///
/// Uses yellow styling with a "~" prefix and supports indented details on subsequent lines.
/// Each detail line is properly indented for readability.
///
/// # Arguments
///
/// * `title` - The main title of the update
/// * `details` - A slice of detail strings to display with indentation
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::infra_updated_detailed;
/// infra_updated_detailed("Table users schema modified", &[
///     "Column changes:",
///     "  + email: String",
///     "  ~ age: Int32 -> Float64"
/// ]);
/// ```
pub fn infra_updated_detailed(title: &str, details: &[String]) {
    infra_updated(title);
    write_detail_lines(details);

    // Log the full message
    info!("~ {} {}", title.trim(), details.join(" "));
}

/// Displays OLAP (Online Analytical Processing) infrastructure changes.
///
/// This function handles the display of changes to OLAP components including
/// tables, views, and SQL resources. Each change type is displayed with
/// appropriate styling and formatting.
///
/// # Arguments
///
/// * `olap_changes` - A slice of OLAP changes to display
///
/// # Change Types Handled
///
/// - **Table Changes**: Added, removed, or updated database tables
/// - **View Changes**: Added, removed, or updated database views  
/// - **SQL Resource Changes**: Added, removed, or updated SQL resources
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::show_olap_changes;
/// show_olap_changes(&infrastructure_plan.changes.olap_changes);
/// ```
pub fn show_olap_changes(olap_changes: &[OlapChange]) {
    olap_changes.iter().for_each(|change| match change {
        OlapChange::Table(TableChange::Added(infra)) => {
            let (title, details) = format_table_display(infra);
            infra_added_detailed(&title, &details);
        }
        OlapChange::Table(TableChange::Removed(infra)) => {
            let (title, details) = format_table_display(infra);
            infra_removed_detailed(&title, &details);
        }
        OlapChange::Table(TableChange::Updated {
            name,
            column_changes,
            ..
        }) => {
            let mut details = Vec::new();

            if !column_changes.is_empty() {
                details.push("Column changes:".to_string());
                for change in column_changes {
                    let change_line = match change {
                        crate::framework::core::infrastructure_map::ColumnChange::Added {
                            column,
                            ..
                        } => {
                            let mut col_str = format!(
                                "{}: {}",
                                column.name,
                                format_column_type(&column.data_type)
                            );

                            // Add nullability and default value
                            col_str.push_str(&format_column_attributes(
                                column.required,
                                column.default.as_ref(),
                            ));

                            // Add constraints as separate info
                            if let Some(constraints_str) =
                                format_column_constraints(column.primary_key, column.unique)
                            {
                                // Remove the leading space and brackets for inline display
                                let constraints_display = constraints_str
                                    .trim_start_matches(" [")
                                    .trim_end_matches(']');
                                format!("  + {}, {}", col_str, constraints_display)
                            } else {
                                format!("  + {}", col_str)
                            }
                        }
                        crate::framework::core::infrastructure_map::ColumnChange::Removed(
                            column,
                        ) => format!(
                            "  - {}: {}",
                            column.name,
                            format_column_type(&column.data_type)
                        ),
                        crate::framework::core::infrastructure_map::ColumnChange::Updated {
                            before,
                            after,
                        } => {
                            // Check if there are actual visible changes
                            let type_changed = before.data_type != after.data_type;
                            let nullable_changed = before.required != after.required;
                            let default_changed = before.default != after.default;
                            let unique_changed = before.unique != after.unique;

                            if !type_changed
                                && !nullable_changed
                                && !default_changed
                                && !unique_changed
                            {
                                // If no visible changes, show a generic update (might be comment or annotation changes)
                                format!("  ~ {}: updated", before.name)
                            } else {
                                // Build before state
                                let mut before_str = format_column_type(&before.data_type);
                                before_str.push_str(&format_column_attributes(
                                    before.required,
                                    before.default.as_ref(),
                                ));

                                // Build after state
                                let mut after_str = format_column_type(&after.data_type);
                                after_str.push_str(&format_column_attributes(
                                    after.required,
                                    after.default.as_ref(),
                                ));

                                // Add unique constraint changes if any
                                let mut extra_changes = Vec::new();
                                if before.unique != after.unique {
                                    if after.unique {
                                        extra_changes.push("now unique".to_string());
                                    } else {
                                        extra_changes.push("no longer unique".to_string());
                                    }
                                }

                                if extra_changes.is_empty() {
                                    format!("  ~ {}: {} -> {}", before.name, before_str, after_str)
                                } else {
                                    format!(
                                        "  ~ {}: {} -> {}, {}",
                                        before.name,
                                        before_str,
                                        after_str,
                                        extra_changes.join(", ")
                                    )
                                }
                            }
                        }
                    };
                    details.push(change_line);
                }
            }

            infra_updated_detailed(&format!("Table: {name}"), &details);
        }
        OlapChange::Table(TableChange::SettingsChanged {
            name,
            before_settings,
            after_settings,
            ..
        }) => {
            let mut details = Vec::new();

            // Show settings that will be modified
            if let Some(after) = after_settings {
                let before = before_settings.clone().unwrap_or_default();
                for (key, value) in after {
                    if before.get(key) != Some(value) {
                        if before.contains_key(key) {
                            details.push(format!(
                                "  ~ {}: {} -> {}",
                                key,
                                before.get(key).unwrap(),
                                value
                            ));
                        } else {
                            details.push(format!("  + {}: {}", key, value));
                        }
                    }
                }
            }

            // Show settings that will be reset (removed)
            if let Some(before) = before_settings {
                let after = after_settings.clone().unwrap_or_default();
                for key in before.keys() {
                    if !after.contains_key(key) {
                        details.push(format!("  - {}: (reset to default)", key));
                    }
                }
            }

            infra_updated_detailed(&format!("Table Settings: {name}"), &details);
        }
        OlapChange::View(view_change) => {
            handle_standard_change!(view_change);
        }
        OlapChange::Table(TableChange::TtlChanged {
            name,
            before,
            after,
            ..
        }) => {
            let mut details = Vec::new();
            match (before, after) {
                (None, Some(expr)) => details.push(format!("  + TTL {}", expr)),
                (Some(_), None) => details.push("  - TTL (removed)".to_string()),
                (Some(b), Some(a)) if b != a => {
                    details.push(format!("  ~ TTL {} -> {}", b, a));
                }
                _ => {}
            }
            infra_updated_detailed(&format!("Table TTL: {name}"), &details);
        }
        OlapChange::SqlResource(Change::Added(sql_resource)) => {
            infra_added(&format!("SQL Resource: {}", sql_resource.name));
        }
        OlapChange::SqlResource(Change::Removed(sql_resource)) => {
            infra_removed(&format!("SQL Resource: {}", sql_resource.name));
        }
        OlapChange::SqlResource(Change::Updated { before, after: _ }) => {
            infra_updated(&format!("SQL Resource: {}", before.name));
        }
        OlapChange::PopulateMaterializedView {
            view_name,
            target_table,
            source_tables,
            ..
        } => {
            let sources = source_tables.join(", ");
            infra_added_detailed(
                &format!("Populate Materialized View: {}", view_name),
                &[
                    format!("Target table: {}", target_table),
                    format!("Source tables: {}", sources),
                ],
            );
        }
    });
}

/// Displays streaming engine infrastructure changes.
///
/// This function handles the display of changes to streaming components
/// including topics and streaming infrastructure.
///
/// # Arguments
///
/// * `streaming_changes` - A slice of streaming changes to display
///
/// # Change Types Handled
///
/// - **Topic Changes**: Added, removed, or updated streaming topics
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::show_streaming_changes;
/// show_streaming_changes(&infrastructure_plan.changes.streaming_engine_changes);
/// ```
pub fn show_streaming_changes(streaming_changes: &[StreamingChange]) {
    streaming_changes.iter().for_each(|change| match change {
        StreamingChange::Topic(topic_change) => {
            // Special case for Updated to use `after` instead of `before`
            match topic_change {
                Change::Added(infra) => infra_added(&infra.expanded_display()),
                Change::Removed(infra) => infra_removed(&infra.short_display()),
                Change::Updated { before: _, after } => infra_updated(&after.expanded_display()),
            }
        }
    });
}

/// Displays process infrastructure changes.
///
/// This function handles the display of changes to various process types
/// including sync processes, functions, and web servers.
///
/// # Arguments
///
/// * `process_changes` - A slice of process changes to display
///
/// # Change Types Handled
///
/// - **Topic to Topic Sync Process**: Data synchronization between topics
/// - **Topic to Table Sync Process**: Data synchronization from topics to tables
/// - **Function Process**: Custom function processes
/// - **OLAP Process**: OLAP processing components
/// - **Consumption API Web Server**: API server processes
/// - **Orchestration Worker**: Background worker processes
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::show_process_changes;
/// show_process_changes(&infrastructure_plan.changes.processes_changes);
/// ```
pub fn show_process_changes(process_changes: &[ProcessChange]) {
    process_changes.iter().for_each(|change| match change {
        ProcessChange::TopicToTopicSyncProcess(sync_change) => {
            handle_standard_change!(sync_change);
        }
        ProcessChange::TopicToTableSyncProcess(sync_change) => {
            handle_standard_change!(sync_change);
        }
        ProcessChange::FunctionProcess(function_change) => {
            handle_standard_change!(function_change);
        }
        ProcessChange::OlapProcess(olap_change) => {
            handle_standard_change!(olap_change);
        }
        ProcessChange::ConsumptionApiWebServer(Change::Added(_)) => {
            infra_added("Starting Consumption WebServer...");
        }
        ProcessChange::ConsumptionApiWebServer(Change::Removed(_)) => {
            infra_removed("Stopping Consumption WebServer...");
        }
        ProcessChange::ConsumptionApiWebServer(Change::Updated { .. }) => {
            infra_updated("Reloading Consumption WebServer...");
        }
        ProcessChange::OrchestrationWorker(Change::Added(_)) => {
            infra_added("Starting Orchestration worker...");
        }
        ProcessChange::OrchestrationWorker(Change::Removed(_)) => {
            infra_removed("Stopping Orchestration worker...");
        }
        ProcessChange::OrchestrationWorker(Change::Updated {
            before: _,
            after: _,
        }) => {
            infra_updated("Reloading Orchestration worker...");
        }
    });
}

/// Displays API infrastructure changes.
///
/// This function handles the display of changes to API components
/// including endpoints and related infrastructure.
///
/// # Arguments
///
/// * `api_changes` - A slice of API changes to display
///
/// # Change Types Handled
///
/// - **API Endpoint Changes**: Added, removed, or updated API endpoints
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::show_api_changes;
/// show_api_changes(&infrastructure_plan.changes.api_changes);
/// ```
pub fn show_api_changes(api_changes: &[ApiChange]) {
    api_changes.iter().for_each(|change| match change {
        ApiChange::ApiEndpoint(endpoint_change) => {
            handle_standard_change!(endpoint_change);
        }
    });
}

/// Displays all infrastructure changes from an InfraPlan.
///
/// This function provides a comprehensive display of all infrastructure changes
/// including streaming engine changes, OLAP changes, process changes, and API changes.
/// Each category of changes is displayed with appropriate formatting and styling.
///
/// # Arguments
///
/// * `infra_plan` - The infrastructure plan containing all changes to display
///
/// # Change Categories Displayed
///
/// - **Streaming Changes**: Topics and streaming infrastructure
/// - **OLAP Changes**: Tables, views, and SQL resources (via `show_olap_changes`)
/// - **Process Changes**: Various process types including sync processes, functions, and web servers
/// - **API Changes**: API endpoints and related infrastructure
///
/// # Examples
///
/// ```rust
/// # use crate::cli::display::infrastructure::show_changes;
/// show_changes(&infrastructure_plan);
/// ```
pub fn show_changes(infra_plan: &InfraPlan) {
    show_streaming_changes(&infra_plan.changes.streaming_engine_changes);
    show_olap_changes(&infra_plan.changes.olap_changes);
    show_process_changes(&infra_plan.changes.processes_changes);
    show_api_changes(&infra_plan.changes.api_changes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::{DataEnum, EnumMember};

    // Note: These tests primarily verify that the functions don't panic
    // and have correct signatures. Testing actual terminal output would
    // require mocking stdout, which is complex for these integration-style functions.

    #[test]
    fn test_infra_functions_dont_panic() {
        // These functions write to stdout and log, so we can't easily test output
        // but we can ensure they don't panic with various inputs

        // Test with normal message
        let _ = std::panic::catch_unwind(|| {
            // We can't actually call these without affecting test output
            // but we can verify the function signatures exist
            let _f1: fn(&str) = infra_added;
            let _f2: fn(&str) = infra_removed;
            let _f3: fn(&str) = infra_updated;
        });
    }

    #[test]
    fn test_show_functions_exist() {
        // Verify function signatures exist and are callable
        let _f1: fn(&[OlapChange]) = show_olap_changes;
        let _f2: fn(&[StreamingChange]) = show_streaming_changes;
        let _f3: fn(&[ProcessChange]) = show_process_changes;
        let _f4: fn(&[ApiChange]) = show_api_changes;
        let _f5: fn(&InfraPlan) = show_changes;
    }

    #[test]
    fn test_empty_slices_dont_panic() {
        // Test that empty slices don't cause panics
        let empty_olap: &[OlapChange] = &[];
        let empty_streaming: &[StreamingChange] = &[];
        let empty_process: &[ProcessChange] = &[];
        let empty_api: &[ApiChange] = &[];

        // These should not panic
        show_olap_changes(empty_olap);
        show_streaming_changes(empty_streaming);
        show_process_changes(empty_process);
        show_api_changes(empty_api);
    }

    #[test]
    fn test_format_column_attributes() {
        // Test with required column and no default
        let result = format_column_attributes(true, None);
        assert_eq!(result, " NOT NULL");

        // Test with optional column and no default
        let result = format_column_attributes(false, None);
        assert_eq!(result, " NULLABLE");

        // Test with required column and default value
        let default_val = "42".to_string();
        let result = format_column_attributes(true, Some(&default_val));
        assert_eq!(result, " NOT NULL DEFAULT=42");

        // Test with optional column and default value
        let default_val = "'test'".to_string();
        let result = format_column_attributes(false, Some(&default_val));
        assert_eq!(result, " NULLABLE DEFAULT='test'");
    }

    #[test]
    fn test_format_column_constraints() {
        // Test with no constraints
        let result = format_column_constraints(false, false);
        assert_eq!(result, None);

        // Test with primary key only
        let result = format_column_constraints(true, false);
        assert_eq!(result, Some(" [primary key]".to_string()));

        // Test with unique only
        let result = format_column_constraints(false, true);
        assert_eq!(result, Some(" [unique]".to_string()));

        // Test with both primary key and unique
        let result = format_column_constraints(true, true);
        assert_eq!(result, Some(" [primary key, unique]".to_string()));
    }

    #[test]
    fn test_format_column_type() {
        // Test with simple type
        let col_type = ColumnType::String;
        let result = format_column_type(&col_type);
        assert_eq!(result, "String");

        // Test with enum type
        let enum_members = vec![
            EnumMember {
                name: "ACTIVE".to_string(),
                value: crate::framework::core::infrastructure::table::EnumValue::Int(1),
            },
            EnumMember {
                name: "INACTIVE".to_string(),
                value: crate::framework::core::infrastructure::table::EnumValue::String(
                    "inactive".to_string(),
                ),
            },
        ];
        let data_enum = DataEnum {
            name: "Status".to_string(),
            values: enum_members,
        };
        let col_type = ColumnType::Enum(data_enum);
        let result = format_column_type(&col_type);
        assert_eq!(result, "Enum<Status>[ACTIVE=1,INACTIVE='inactive']");
    }

    #[test]
    fn test_format_column_type_with_numeric_types() {
        use crate::framework::core::infrastructure::table::{FloatType, IntType};

        // Test various numeric types - using Debug formatting since ColumnType doesn't implement Display
        let col_type = ColumnType::Int(IntType::Int32);
        let result = format_column_type(&col_type);
        // Debug format will be "Int(Int32)"
        assert!(result.contains("Int32"));

        let col_type = ColumnType::Float(FloatType::Float64);
        let result = format_column_type(&col_type);
        // Debug format will be "Float(Float64)"
        assert!(result.contains("Float64"));

        let col_type = ColumnType::Boolean;
        let result = format_column_type(&col_type);
        assert_eq!(result, "Boolean");
    }

    // Integration tests would go here if we had mock infrastructure objects
    // For now, the main testing happens at the integration level where
    // actual infrastructure changes are created and displayed.
}
