use handlebars::{no_escape, Handlebars};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::framework::core::infrastructure::table::EnumValue;
use crate::infrastructure::olap::clickhouse::model::{
    wrap_and_join_column_names, AggregationFunction, ClickHouseColumnType, ClickHouseFloat,
    ClickHouseInt, ClickHouseTable,
};

use super::errors::ClickhouseError;
use super::model::ClickHouseColumn;

// Unclear if we need to add flatten_nested to the views setting as well
static CREATE_ALIAS_TEMPLATE: &str = r#"
CREATE VIEW IF NOT EXISTS `{{db_name}}`.`{{alias_name}}` AS SELECT * FROM `{{db_name}}`.`{{source_table_name}}`;
"#;

fn create_alias_query(
    db_name: &str,
    alias_name: &str,
    source_table_name: &str,
) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let context = json!({
        "db_name": db_name,
        "alias_name": alias_name,
        "source_table_name": source_table_name,
    });

    Ok(reg.render_template(CREATE_ALIAS_TEMPLATE, &context)?)
}

static CREATE_VIEW_TEMPLATE: &str = r#"
CREATE VIEW IF NOT EXISTS `{{db_name}}`.`{{view_name}}` AS {{view_query}};
"#;

pub fn create_view_query(
    db_name: &str,
    view_name: &str,
    view_query: &str,
) -> Result<String, ClickhouseError> {
    let reg = Handlebars::new();

    let context = json!({
        "db_name": db_name,
        "view_name": view_name,
        "view_query": view_query,
    });

    Ok(reg.render_template(CREATE_VIEW_TEMPLATE, &context)?)
}

static DROP_VIEW_TEMPLATE: &str = r#"
DROP VIEW `{{db_name}}`.`{{view_name}}`;
"#;

pub fn drop_view_query(db_name: &str, view_name: &str) -> Result<String, ClickhouseError> {
    let reg = Handlebars::new();

    let context = json!({
        "db_name": db_name,
        "view_name": view_name,
    });

    Ok(reg.render_template(DROP_VIEW_TEMPLATE, &context)?)
}

static UPDATE_VIEW_TEMPLATE: &str = r#"
CREATE OR REPLACE VIEW `{{db_name}}`.`{{view_name}}` AS {{view_query}};
"#;

pub fn update_view_query(
    db_name: &str,
    view_name: &str,
    view_query: &str,
) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let context = json!({
        "db_name": db_name,
        "view_name": view_name,
        "view_query": view_query,
    });

    Ok(reg.render_template(UPDATE_VIEW_TEMPLATE, &context)?)
}

pub fn create_alias_for_table(
    db_name: &str,
    alias_name: &str,
    latest_table: &ClickHouseTable,
) -> Result<String, ClickhouseError> {
    create_alias_query(db_name, alias_name, &latest_table.name)
}

static CREATE_TABLE_TEMPLATE: &str = r#"
CREATE TABLE IF NOT EXISTS `{{db_name}}`.`{{table_name}}`
(
{{#each fields}} `{{field_name}}` {{{field_type}}} {{field_nullable}}{{#if field_default}} DEFAULT {{{field_default}}}{{/if}}{{#if field_comment}} COMMENT '{{{field_comment}}}'{{/if}}{{#unless @last}},{{/unless}}
{{/each}}
)
ENGINE = {{engine}}{{#if primary_key_string}}
PRIMARY KEY ({{primary_key_string}}){{/if}}{{#if order_by_string}}
ORDER BY ({{order_by_string}}){{/if}}{{#if settings}}
SETTINGS {{settings}}{{/if}}"#;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)] // S3Queue has many fields, but this is acceptable for our use case
pub enum ClickhouseEngine {
    MergeTree,
    ReplacingMergeTree,
    AggregatingMergeTree,
    SummingMergeTree,
    S3Queue {
        // Non-alterable constructor parameters - required for table creation
        s3_path: String,
        format: String,
        compression: Option<String>,
        headers: Option<std::collections::HashMap<String, String>>,
        // Credentials for DDL generation - may be None when loaded from protocol buffer
        aws_access_key_id: Option<String>,
        aws_secret_access_key: Option<String>,
    },
}

// The implementation is not symetric between TryFrom and Into so we
// need to allow this clippy warning
#[allow(clippy::from_over_into)]
impl Into<String> for ClickhouseEngine {
    fn into(self) -> String {
        match self {
            ClickhouseEngine::MergeTree => "MergeTree".to_string(),
            ClickhouseEngine::ReplacingMergeTree => "ReplacingMergeTree".to_string(),
            ClickhouseEngine::AggregatingMergeTree => "AggregatingMergeTree".to_string(),
            ClickhouseEngine::SummingMergeTree => "SummingMergeTree".to_string(),
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                headers,
                aws_access_key_id,
                aws_secret_access_key,
                ..
            } => Self::serialize_s3queue_for_display(
                &s3_path,
                &format,
                &compression,
                &headers,
                &aws_access_key_id,
                &aws_secret_access_key,
            ),
        }
    }
}

impl<'a> TryFrom<&'a str> for ClickhouseEngine {
    type Error = &'a str;

    fn try_from(value: &'a str) -> Result<Self, &'a str> {
        // "There is a SharedMergeTree analog for every specific MergeTree engine type"
        match value
            .strip_prefix("Shared")
            // TODO: properly handle replicated
            .unwrap_or(value.strip_prefix("Replicated").unwrap_or(value))
        {
            "MergeTree" => Ok(ClickhouseEngine::MergeTree),
            "ReplacingMergeTree" => Ok(ClickhouseEngine::ReplacingMergeTree),
            "AggregatingMergeTree" => Ok(ClickhouseEngine::AggregatingMergeTree),
            "SummingMergeTree" => Ok(ClickhouseEngine::SummingMergeTree),
            s if s.starts_with("S3Queue(") => {
                if let Some(content) = s.strip_prefix("S3Queue(").and_then(|s| s.strip_suffix(")"))
                {
                    Self::parse_s3queue(content).map_err(|_| value)
                } else {
                    Err(value)
                }
            }
            _ => Err(value),
        }
    }
}

/// Parse comma-separated quoted values from a string
/// Handles escaped quotes within values
fn parse_quoted_csv(content: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escape_next = false;

    for ch in content.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
        } else if ch == '\\' {
            escape_next = true;
        } else if ch == '\'' && !in_quotes {
            in_quotes = true;
        } else if ch == '\'' && in_quotes {
            in_quotes = false;
        } else if ch == ',' && !in_quotes {
            let trimmed = current.trim().trim_matches('\'').to_string();
            if !trimmed.is_empty() || current.contains("null") {
                parts.push(trimmed);
            }
            current.clear();
        } else if ch != ' ' || in_quotes || !current.is_empty() {
            // Skip leading spaces, but preserve spaces within quotes or after content starts
            current.push(ch);
        }
    }

    // Don't forget the last part
    if !current.is_empty() {
        parts.push(current.trim().trim_matches('\'').to_string());
    }

    parts
}

impl ClickhouseEngine {
    /// Check if this engine is part of the MergeTree family
    pub fn is_merge_tree_family(&self) -> bool {
        matches!(
            self,
            ClickhouseEngine::MergeTree
                | ClickhouseEngine::ReplacingMergeTree
                | ClickhouseEngine::AggregatingMergeTree
                | ClickhouseEngine::SummingMergeTree
        )
    }

    /// Convert engine to string for proto storage (no sensitive data)
    pub fn to_proto_string(&self) -> String {
        match self {
            ClickhouseEngine::MergeTree => "MergeTree".to_string(),
            ClickhouseEngine::ReplacingMergeTree => "ReplacingMergeTree".to_string(),
            ClickhouseEngine::AggregatingMergeTree => "AggregatingMergeTree".to_string(),
            ClickhouseEngine::SummingMergeTree => "SummingMergeTree".to_string(),
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                headers,
                ..
            } => Self::serialize_s3queue(s3_path, format, compression, headers),
        }
    }

    /// Serialize S3Queue engine to string format for proto storage
    /// Format: S3Queue('path', 'format', 'compression'|null, 'headers_json'|null)
    fn serialize_s3queue(
        s3_path: &str,
        format: &str,
        compression: &Option<String>,
        headers: &Option<std::collections::HashMap<String, String>>,
    ) -> String {
        let mut result = format!("S3Queue('{}', '{}'", s3_path, format);

        // Add compression if present
        if let Some(comp) = compression {
            result.push_str(&format!(", '{}'", comp));
        } else {
            result.push_str(", null");
        }

        // Add headers as JSON if present
        if let Some(hdrs) = headers {
            let headers_json = serde_json::to_string(hdrs).unwrap_or_else(|_| "{}".to_string());
            // Escape single quotes in JSON for SQL string
            result.push_str(&format!(", '{}'", headers_json.replace('\'', "\\'")));
        } else {
            result.push_str(", null");
        }

        result.push(')');
        result
    }

    /// Serialize S3Queue engine for display purposes, including masked credentials
    /// Format: S3Queue('path', 'format', auth_info, 'compression'|null, 'headers_json'|null)
    fn serialize_s3queue_for_display(
        s3_path: &str,
        format: &str,
        compression: &Option<String>,
        headers: &Option<std::collections::HashMap<String, String>>,
        aws_access_key_id: &Option<String>,
        aws_secret_access_key: &Option<String>,
    ) -> String {
        let mut result = format!("S3Queue('{}', '{}'", s3_path, format);

        // Add authentication info for display
        match (aws_access_key_id, aws_secret_access_key) {
            (Some(key_id), Some(secret)) => {
                // Show the full access key ID and first 4 + last 4 chars of secret
                let masked_secret = if secret.len() > 8 {
                    format!("{}...{}", &secret[..4], &secret[secret.len() - 4..])
                } else {
                    // For very short secrets, just show partial
                    format!("{}...", &secret[..secret.len().min(3)])
                };
                result.push_str(&format!(", auth='{}:{}'", key_id, masked_secret));
            }
            (None, None) => {
                result.push_str(", auth=NOSIGN");
            }
            _ => {
                // Partial credentials (shouldn't happen but handle gracefully)
                result.push_str(", auth=INVALID");
            }
        }

        // Add compression if present
        if let Some(comp) = compression {
            result.push_str(&format!(", compression='{}'", comp));
        }

        // Add headers count if present (don't show actual headers for brevity)
        if let Some(hdrs) = headers {
            if !hdrs.is_empty() {
                result.push_str(&format!(", headers_count={}", hdrs.len()));
            }
        }

        result.push(')');
        result
    }

    /// Parse S3Queue engine from serialized string format
    /// Expected format: S3Queue('path', 'format'[, 'compression'][, 'headers_json'])
    fn parse_s3queue(content: &str) -> Result<ClickhouseEngine, &str> {
        // Parse comma-separated quoted values with proper quote escaping
        let parts = parse_quoted_csv(content);

        if parts.len() < 2 {
            return Err("S3Queue requires at least path and format parameters");
        }

        let s3_path = parts[0].clone();

        // Determine authentication method and format position
        // Possible formats:
        // 1. S3Queue('path', 'format', ...) - no auth
        // 2. S3Queue('path', NOSIGN, 'format', ...) - explicit no auth
        // 3. S3Queue('path', 'access_key_id', 'secret_access_key', 'format', ...) - with credentials
        let (format, aws_access_key_id, aws_secret_access_key, extra_params_start) =
            if parts.len() >= 2 && parts[1].to_uppercase() == "NOSIGN" {
                // NOSIGN authentication - format is at position 2
                if parts.len() < 3 {
                    return Err("S3Queue with NOSIGN requires format parameter");
                }
                (parts[2].clone(), None, None, 3)
            } else if parts.len() >= 4 && !parts[1].is_empty() && !parts[2].is_empty() {
                // Check if parts[1] and parts[2] look like credentials (not format names)
                // Common formats are: CSV, TSV, JSON, Parquet, etc. - all uppercase or mixed case
                // If parts[3] looks like a format name and parts[1] doesn't, assume we have credentials
                let possible_format = &parts[3].to_uppercase();
                if possible_format == "CSV"
                    || possible_format == "TSV"
                    || possible_format == "JSON"
                    || possible_format == "PARQUET"
                    || possible_format == "AVRO"
                    || possible_format == "ORC"
                    || possible_format == "ARROW"
                    || possible_format == "NATIVE"
                    || possible_format == "JSONCOMPACT"
                    || possible_format == "JSONEACHROW"
                {
                    // parts[1] and parts[2] are likely credentials
                    // Note: parts[2] might be "[HIDDEN]" when parsed from SHOW CREATE TABLE
                    (
                        parts[3].clone(),
                        Some(parts[1].clone()),
                        Some(parts[2].clone()),
                        4,
                    )
                } else {
                    // No credentials, parts[1] is the format
                    (parts[1].clone(), None, None, 2)
                }
            } else {
                // No credentials, parts[1] is the format
                (parts[1].clone(), None, None, 2)
            };

        // Parse optional compression (next parameter after format)
        let compression = if parts.len() > extra_params_start && parts[extra_params_start] != "null"
        {
            Some(parts[extra_params_start].clone())
        } else {
            None
        };

        // Parse optional headers JSON (parameter after compression)
        let headers =
            if parts.len() > extra_params_start + 1 && parts[extra_params_start + 1] != "null" {
                // Unescape the JSON string (reverse the escaping we did during serialization)
                let unescaped = parts[extra_params_start + 1].replace("\\'", "'");
                serde_json::from_str::<std::collections::HashMap<String, String>>(&unescaped).ok()
            } else {
                None
            };

        Ok(ClickhouseEngine::S3Queue {
            s3_path,
            format,
            compression,
            headers,
            aws_access_key_id,
            aws_secret_access_key,
        })
    }

    /// Calculate a hash of non-alterable parameters for change detection
    /// This allows us to detect changes in constructor parameters without storing sensitive data
    pub fn non_alterable_params_hash(&self) -> String {
        let mut hasher = Sha256::new();

        match self {
            ClickhouseEngine::MergeTree => {
                hasher.update("MergeTree".as_bytes());
            }
            ClickhouseEngine::ReplacingMergeTree => {
                hasher.update("ReplacingMergeTree".as_bytes());
            }
            ClickhouseEngine::AggregatingMergeTree => {
                hasher.update("AggregatingMergeTree".as_bytes());
            }
            ClickhouseEngine::SummingMergeTree => {
                hasher.update("SummingMergeTree".as_bytes());
            }
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                headers,
                aws_access_key_id,
                aws_secret_access_key,
                ..
            } => {
                hasher.update("S3Queue".as_bytes());
                hasher.update(s3_path.as_bytes());
                hasher.update(format.as_bytes());

                // Hash compression in a deterministic way
                if let Some(comp) = compression {
                    hasher.update(comp.as_bytes());
                } else {
                    hasher.update("null".as_bytes());
                }

                // Hash headers in a deterministic way
                if let Some(headers_map) = headers {
                    let mut sorted_headers: Vec<_> = headers_map.iter().collect();
                    sorted_headers.sort_by_key(|(k, _)| *k);
                    for (key, value) in sorted_headers {
                        hasher.update(key.as_bytes());
                        hasher.update(value.as_bytes());
                    }
                } else {
                    hasher.update("null".as_bytes());
                }

                // Include credentials in the hash for change detection
                // They affect table creation but we don't store them in proto
                // Note: When retrieved from SHOW CREATE TABLE, secret will be "[HIDDEN]"
                // which produces a different hash. The reconciliation logic handles this
                // by keeping the hash from the infrastructure map instead of the DB
                // for ALL engines (not just S3Queue).
                if let Some(key_id) = aws_access_key_id {
                    hasher.update(key_id.as_bytes());
                } else {
                    hasher.update("null".as_bytes());
                }

                if let Some(secret) = aws_secret_access_key {
                    hasher.update(secret.as_bytes());
                } else {
                    hasher.update("null".as_bytes());
                }

                // Note: settings are NOT included as they are alterable
            }
        }

        format!("{:x}", hasher.finalize())
    }
}

pub fn create_table_query(
    db_name: &str,
    table: ClickHouseTable,
) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let engine = match &table.engine {
        ClickhouseEngine::MergeTree => "MergeTree".to_string(),
        ClickhouseEngine::ReplacingMergeTree => {
            if table.order_by.is_empty() {
                return Err(ClickhouseError::InvalidParameters {
                    message: "ReplacingMergeTree requires an order by clause".to_string(),
                });
            }
            "ReplacingMergeTree".to_string()
        }
        ClickhouseEngine::AggregatingMergeTree => "AggregatingMergeTree".to_string(),
        ClickhouseEngine::SummingMergeTree => "SummingMergeTree".to_string(),
        ClickhouseEngine::S3Queue {
            s3_path,
            format,
            compression,
            headers: _headers, // TODO: Handle headers in future if needed
            aws_access_key_id,
            aws_secret_access_key,
            ..
        } => {
            // Build the engine string based on available parameters
            let mut engine_parts = vec![format!("'{}'", s3_path)];

            // Handle credentials from the engine configuration
            if let (Some(key_id), Some(secret)) = (aws_access_key_id, aws_secret_access_key) {
                engine_parts.push(format!("'{}'", key_id));
                engine_parts.push(format!("'{}'", secret));
            } else {
                // Default to NOSIGN for public buckets or when credentials are not available
                engine_parts.push("NOSIGN".to_string());
            }

            engine_parts.push(format!("'{}'", format));

            // Add compression if specified
            if let Some(comp) = compression {
                engine_parts.push(format!("'{}'", comp));
            }

            format!("S3Queue({})", engine_parts.join(", "))
        }
    };

    // Format settings from table.table_settings
    let settings = if let Some(ref table_settings) = table.table_settings {
        if !table_settings.is_empty() {
            let mut settings_pairs: Vec<(String, String)> = table_settings
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            settings_pairs.sort_by(|a, b| a.0.cmp(&b.0)); // Sort by key for deterministic order
            let settings_strs: Vec<String> = settings_pairs
                .iter()
                .map(|(key, value)| format!("{} = '{}'", key, value))
                .collect();
            Some(settings_strs.join(", "))
        } else {
            None
        }
    } else {
        None
    };

    let primary_key = table
        .columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<String>>();

    let template_context = json!({
        "db_name": db_name,
        "table_name": table.name,
        "fields":  builds_field_context(&table.columns)?,
        "primary_key_string": if !primary_key.is_empty() {
            Some(wrap_and_join_column_names(&primary_key, ","))
        } else {
            None
        },
        "order_by_string": if table.order_by.len() == 1 && table.order_by[0] == "tuple()" {
            Some(table.order_by[0].to_string())
        } else if !table.order_by.is_empty() {
            Some(wrap_and_join_column_names(&table.order_by, ","))
        } else {
            None
        },
        "engine": engine,
        "settings": settings
    });

    Ok(reg.render_template(CREATE_TABLE_TEMPLATE, &template_context)?)
}

pub static DROP_TABLE_TEMPLATE: &str = r#"
DROP TABLE IF EXISTS `{{db_name}}`.`{{table_name}}`;
"#;

pub fn drop_table_query(db_name: &str, table_name: &str) -> Result<String, ClickhouseError> {
    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let context = json!({
        "db_name": db_name,
        "table_name": table_name,
    });

    Ok(reg.render_template(DROP_TABLE_TEMPLATE, &context)?)
}

pub static ALTER_TABLE_MODIFY_SETTINGS_TEMPLATE: &str = r#"
ALTER TABLE `{{db_name}}`.`{{table_name}}`
MODIFY SETTING {{settings}};
"#;

pub static ALTER_TABLE_RESET_SETTINGS_TEMPLATE: &str = r#"
ALTER TABLE `{{db_name}}`.`{{table_name}}`
RESET SETTING {{settings}};
"#;

/// Generate an ALTER TABLE MODIFY SETTING query to change table settings
pub fn alter_table_modify_settings_query(
    db_name: &str,
    table_name: &str,
    settings: &std::collections::HashMap<String, String>,
) -> Result<String, ClickhouseError> {
    if settings.is_empty() {
        return Err(ClickhouseError::InvalidParameters {
            message: "No settings provided for ALTER TABLE MODIFY SETTING".to_string(),
        });
    }

    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    // Format settings as key = 'value' pairs
    let mut settings_pairs: Vec<(String, String)> = settings
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    settings_pairs.sort_by(|a, b| a.0.cmp(&b.0)); // Sort by key for deterministic order
    let settings_str = settings_pairs
        .iter()
        .map(|(key, value)| format!("{} = '{}'", key, value))
        .collect::<Vec<String>>()
        .join(", ");

    let context = json!({
        "db_name": db_name,
        "table_name": table_name,
        "settings": settings_str,
    });

    Ok(reg.render_template(ALTER_TABLE_MODIFY_SETTINGS_TEMPLATE, &context)?)
}

/// Generate an ALTER TABLE RESET SETTING query to reset table settings to defaults
pub fn alter_table_reset_settings_query(
    db_name: &str,
    table_name: &str,
    setting_names: &[String],
) -> Result<String, ClickhouseError> {
    if setting_names.is_empty() {
        return Err(ClickhouseError::InvalidParameters {
            message: "No settings provided for ALTER TABLE RESET SETTING".to_string(),
        });
    }

    let mut reg = Handlebars::new();
    reg.register_escape_fn(no_escape);

    let settings_str = setting_names.join(", ");

    let context = json!({
        "db_name": db_name,
        "table_name": table_name,
        "settings": settings_str,
    });

    Ok(reg.render_template(ALTER_TABLE_RESET_SETTINGS_TEMPLATE, &context)?)
}

pub fn basic_field_type_to_string(
    field_type: &ClickHouseColumnType,
) -> Result<String, ClickhouseError> {
    // Blowing out match statements here in case we need to customize the output string for some types.
    match field_type {
        ClickHouseColumnType::String => Ok(field_type.to_string()),
        ClickHouseColumnType::Boolean => Ok(field_type.to_string()),
        ClickHouseColumnType::ClickhouseInt(int) => match int {
            ClickHouseInt::Int8 => Ok(int.to_string()),
            ClickHouseInt::Int16 => Ok(int.to_string()),
            ClickHouseInt::Int32 => Ok(int.to_string()),
            ClickHouseInt::Int64 => Ok(int.to_string()),
            ClickHouseInt::Int128 => Ok(int.to_string()),
            ClickHouseInt::Int256 => Ok(int.to_string()),
            ClickHouseInt::UInt8 => Ok(int.to_string()),
            ClickHouseInt::UInt16 => Ok(int.to_string()),
            ClickHouseInt::UInt32 => Ok(int.to_string()),
            ClickHouseInt::UInt64 => Ok(int.to_string()),
            ClickHouseInt::UInt128 => Ok(int.to_string()),
            ClickHouseInt::UInt256 => Ok(int.to_string()),
        },
        ClickHouseColumnType::ClickhouseFloat(float) => match float {
            ClickHouseFloat::Float32 => Ok(float.to_string()),
            ClickHouseFloat::Float64 => Ok(float.to_string()),
        },
        ClickHouseColumnType::Decimal { precision, scale } => {
            Ok(format!("Decimal({precision}, {scale})"))
        }
        ClickHouseColumnType::DateTime => Ok("DateTime('UTC')".to_string()),
        ClickHouseColumnType::Enum(data_enum) => {
            let enum_statement = data_enum
                .values
                .iter()
                .map(|enum_member| match &enum_member.value {
                    EnumValue::Int(int) => format!("'{}' = {}", enum_member.name, int),
                    // "Numbers are assigned starting from 1 by default."
                    EnumValue::String(string) => format!("'{string}'"),
                })
                .collect::<Vec<String>>()
                .join(",");

            Ok(format!("Enum({enum_statement})"))
        }
        ClickHouseColumnType::Nested(cols) => {
            let nested_fields = cols
                .iter()
                .map(|col| {
                    let field_type_string = basic_field_type_to_string(&col.column_type)?;
                    match col.required {
                        true => Ok(format!("{} {}", col.name, field_type_string)),
                        false => Ok(format!("{} Nullable({})", col.name, field_type_string)),
                    }
                })
                .collect::<Result<Vec<String>, ClickhouseError>>()?
                .join(", ");

            Ok(format!("Nested({nested_fields})"))
        }
        ClickHouseColumnType::Json => Ok("JSON".to_string()),
        ClickHouseColumnType::Bytes => Err(ClickhouseError::UnsupportedDataType {
            type_name: "Bytes".to_string(),
        }),
        ClickHouseColumnType::Array(inner_type) => {
            let inner_type_string = basic_field_type_to_string(inner_type)?;
            Ok(format!("Array({inner_type_string})"))
        }
        ClickHouseColumnType::Nullable(inner_type) => {
            let inner_type_string = basic_field_type_to_string(inner_type)?;
            // <column_name> String NULL is equivalent to <column_name> Nullable(String)
            Ok(format!("Nullable({inner_type_string})"))
        }
        ClickHouseColumnType::AggregateFunction(
            AggregationFunction {
                function_name,
                argument_types,
            },
            _return_type,
        ) => {
            let inner_type_string = argument_types
                .iter()
                .map(basic_field_type_to_string)
                .collect::<Result<Vec<String>, _>>()?
                .join(", ");
            Ok(format!(
                "AggregateFunction({function_name}, {inner_type_string})"
            ))
        }
        ClickHouseColumnType::Uuid => Ok("UUID".to_string()),
        ClickHouseColumnType::Date32 => Ok("Date32".to_string()),
        ClickHouseColumnType::Date => Ok("Date".to_string()),
        ClickHouseColumnType::DateTime64 { precision } => Ok(format!("DateTime64({precision})")),
        ClickHouseColumnType::LowCardinality(inner_type) => Ok(format!(
            "LowCardinality({})",
            basic_field_type_to_string(inner_type)?
        )),
        ClickHouseColumnType::IpV4 => Ok("IPv4".to_string()),
        ClickHouseColumnType::IpV6 => Ok("IPv6".to_string()),
        ClickHouseColumnType::NamedTuple(fields) => {
            let pairs = fields
                .iter()
                .map(|(name, t)| {
                    Ok::<_, ClickhouseError>(format!("{name} {}", basic_field_type_to_string(t)?))
                })
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("Tuple({pairs})"))
        }
        ClickHouseColumnType::Map(key_type, value_type) => Ok(format!(
            "Map({}, {})",
            basic_field_type_to_string(key_type)?,
            basic_field_type_to_string(value_type)?
        )),
    }
}

fn builds_field_context(columns: &[ClickHouseColumn]) -> Result<Vec<Value>, ClickhouseError> {
    columns
        .iter()
        .map(|column| {
            let field_type = basic_field_type_to_string(&column.column_type)?;

            // Escape single quotes in comments for SQL safety
            let escaped_comment = column.comment.as_ref().map(|c| c.replace('\'', "''"));

            Ok(json!({
                "field_name": column.name,
                "field_type": field_type,
                "field_default": column.default,
                "field_nullable": if let ClickHouseColumnType::Nullable(_) = column.column_type {
                    // if type is Nullable, do not add extra specifier
                    "".to_string()
                } else if column.required || column.is_array() || column.is_nested() {
                    // Clickhouse doesn't allow array/nested fields to be nullable
                    "NOT NULL".to_string()
                } else {
                    "NULL".to_string()
                },
                "field_comment": escaped_comment,
            }))
        })
        .collect::<Result<Vec<Value>, ClickhouseError>>()
}

// Tests
#[cfg(test)]
mod tests {
    use std::vec;

    use super::*;
    use crate::framework::core::infrastructure::table::{DataEnum, EnumMember};
    use crate::framework::versions::Version;

    #[test]
    fn test_nested_query_generator() {
        let complete_nest_type = ClickHouseColumnType::Nested(vec![
            ClickHouseColumn {
                name: "nested_field_1".to_string(),
                column_type: ClickHouseColumnType::String,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_2".to_string(),
                column_type: ClickHouseColumnType::Boolean,
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_3".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_4".to_string(),
                column_type: ClickHouseColumnType::ClickhouseFloat(ClickHouseFloat::Float64),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_5".to_string(),
                column_type: ClickHouseColumnType::DateTime,
                required: false,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_6".to_string(),
                column_type: ClickHouseColumnType::Enum(DataEnum {
                    name: "TestEnum".to_string(),
                    values: vec![
                        EnumMember {
                            name: "TestEnumValue1".to_string(),
                            value: EnumValue::Int(1),
                        },
                        EnumMember {
                            name: "TestEnumValue2".to_string(),
                            value: EnumValue::Int(2),
                        },
                    ],
                }),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
            ClickHouseColumn {
                name: "nested_field_7".to_string(),
                column_type: ClickHouseColumnType::Array(Box::new(ClickHouseColumnType::String)),
                required: true,
                unique: false,
                primary_key: false,
                default: None,
                comment: None,
            },
        ]);

        let expected_nested_query = "Nested(nested_field_1 String, nested_field_2 Boolean, nested_field_3 Int64, nested_field_4 Float64, nested_field_5 Nullable(DateTime('UTC')), nested_field_6 Enum('TestEnumValue1' = 1,'TestEnumValue2' = 2), nested_field_7 Array(String))";

        let nested_query = basic_field_type_to_string(&complete_nest_type).unwrap();

        assert_eq!(nested_query, expected_nested_query);
    }

    #[test]
    fn test_nested_nested_generator() {}

    #[test]
    fn test_create_table_query_basic() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![
                ClickHouseColumn {
                    name: "id".to_string(),
                    column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                    required: true,
                    primary_key: true,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "name".to_string(),
                    column_type: ClickHouseColumnType::String,
                    required: false,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
            ],
            order_by: vec![],
            engine: ClickhouseEngine::MergeTree,
            table_settings: None,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL,
 `name` String NULL
)
ENGINE = MergeTree
PRIMARY KEY (`id`)
"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_with_default_nullable_string() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "name".to_string(),
                column_type: ClickHouseColumnType::String,
                required: false,
                primary_key: false,
                unique: false,
                default: Some("'abc'".to_string()),
                comment: None,
            }],
            order_by: vec![],
            engine: ClickhouseEngine::MergeTree,
            table_settings: None,
        };

        let query = create_table_query("test_db", table).unwrap();
        // DEFAULT should appear after nullable marker
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `name` String NULL DEFAULT 'abc'
)
ENGINE = MergeTree
"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_with_default_not_null_int() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "count".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: false,
                unique: false,
                default: Some("42".to_string()),
                comment: None,
            }],
            order_by: vec![],
            engine: ClickhouseEngine::MergeTree,
            table_settings: None,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `count` Int32 NOT NULL DEFAULT 42
)
ENGINE = MergeTree
"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_replacing_merge_tree() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "id".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: true,
                unique: false,
                default: None,
                comment: None,
            }],
            order_by: vec!["id".to_string()],
            engine: ClickhouseEngine::ReplacingMergeTree,
            table_settings: None,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL
)
ENGINE = ReplacingMergeTree
PRIMARY KEY (`id`)
ORDER BY (`id`) "#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_replacing_merge_tree_error() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "id".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: true,
                unique: false,
                default: None,
                comment: None,
            }],
            engine: ClickhouseEngine::ReplacingMergeTree,
            order_by: vec![],
            table_settings: None,
        };

        let result = create_table_query("test_db", table);
        assert!(matches!(
            result,
            Err(ClickhouseError::InvalidParameters { message }) if message == "ReplacingMergeTree requires an order by clause"
        ));
    }

    #[test]
    fn test_create_table_query_complex() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![
                ClickHouseColumn {
                    name: "id".to_string(),
                    column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                    required: true,
                    primary_key: true,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "nested_data".to_string(),
                    column_type: ClickHouseColumnType::Nested(vec![
                        ClickHouseColumn {
                            name: "field1".to_string(),
                            column_type: ClickHouseColumnType::String,
                            required: true,
                            primary_key: false,
                            unique: false,
                            default: None,
                            comment: None,
                        },
                        ClickHouseColumn {
                            name: "field2".to_string(),
                            column_type: ClickHouseColumnType::Boolean,
                            required: false,
                            primary_key: false,
                            unique: false,
                            default: None,
                            comment: None,
                        },
                    ]),
                    required: true,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "status".to_string(),
                    column_type: ClickHouseColumnType::Enum(DataEnum {
                        name: "Status".to_string(),
                        values: vec![
                            EnumMember {
                                name: "Active".to_string(),
                                value: EnumValue::Int(1),
                            },
                            EnumMember {
                                name: "Inactive".to_string(),
                                value: EnumValue::Int(2),
                            },
                        ],
                    }),
                    required: true,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
            ],
            engine: ClickhouseEngine::MergeTree,
            order_by: vec!["id".to_string()],
            table_settings: None,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL,
 `nested_data` Nested(field1 String, field2 Nullable(Boolean)) NOT NULL,
 `status` Enum('Active' = 1,'Inactive' = 2) NOT NULL
)
ENGINE = MergeTree
PRIMARY KEY (`id`)
ORDER BY (`id`) "#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_create_table_query_s3queue() {
        let mut settings = std::collections::HashMap::new();
        settings.insert("mode".to_string(), "unordered".to_string());
        settings.insert(
            "keeper_path".to_string(),
            "/clickhouse/s3queue/test_table".to_string(),
        );
        settings.insert("s3queue_loading_retries".to_string(), "3".to_string());

        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![
                ClickHouseColumn {
                    name: "id".to_string(),
                    column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                    required: true,
                    primary_key: true,
                    unique: false,
                    default: None,
                    comment: None,
                },
                ClickHouseColumn {
                    name: "data".to_string(),
                    column_type: ClickHouseColumnType::String,
                    required: true,
                    primary_key: false,
                    unique: false,
                    default: None,
                    comment: None,
                },
            ],
            order_by: vec![],
            engine: ClickhouseEngine::S3Queue {
                s3_path: "s3://my-bucket/data/*.json".to_string(),
                format: "JSONEachRow".to_string(),
                compression: None,
                headers: None,
                aws_access_key_id: None,
                aws_secret_access_key: None,
            },
            table_settings: Some(settings),
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL,
 `data` String NOT NULL
)
ENGINE = S3Queue('s3://my-bucket/data/*.json', NOSIGN, 'JSONEachRow')
PRIMARY KEY (`id`)
SETTINGS keeper_path = '/clickhouse/s3queue/test_table', mode = 'unordered', s3queue_loading_retries = '3'"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_s3queue_parsing_with_credentials() {
        let engine_str = "S3Queue('https://test-s3-queue-engine.s3.eu-north-1.amazonaws.com/*', 'AKIA6OQXSVQF4HIUAX5J', 'secret123', 'CSV')";
        let result = ClickhouseEngine::try_from(engine_str);
        assert!(result.is_ok());

        if let Ok(ClickhouseEngine::S3Queue {
            s3_path,
            format,
            aws_access_key_id,
            aws_secret_access_key,
            ..
        }) = result
        {
            assert_eq!(
                s3_path,
                "https://test-s3-queue-engine.s3.eu-north-1.amazonaws.com/*"
            );
            assert_eq!(format, "CSV");
            assert_eq!(aws_access_key_id, Some("AKIA6OQXSVQF4HIUAX5J".to_string()));
            assert_eq!(aws_secret_access_key, Some("secret123".to_string()));
        } else {
            panic!("Expected S3Queue engine");
        }
    }

    #[test]
    fn test_s3queue_parsing_without_credentials() {
        let engine_str = "S3Queue('https://public-bucket.s3.amazonaws.com/*', 'JSON')";
        let result = ClickhouseEngine::try_from(engine_str);
        assert!(result.is_ok());

        if let Ok(ClickhouseEngine::S3Queue {
            s3_path,
            format,
            aws_access_key_id,
            aws_secret_access_key,
            ..
        }) = result
        {
            assert_eq!(s3_path, "https://public-bucket.s3.amazonaws.com/*");
            assert_eq!(format, "JSON");
            assert_eq!(aws_access_key_id, None);
            assert_eq!(aws_secret_access_key, None);
        } else {
            panic!("Expected S3Queue engine");
        }
    }

    #[test]
    fn test_s3queue_parsing_with_nosign() {
        let engine_str = "S3Queue('https://public-bucket.s3.amazonaws.com/*', NOSIGN, 'CSV')";
        let result = ClickhouseEngine::try_from(engine_str);
        assert!(result.is_ok());

        if let Ok(ClickhouseEngine::S3Queue {
            s3_path,
            format,
            aws_access_key_id,
            aws_secret_access_key,
            ..
        }) = result
        {
            assert_eq!(s3_path, "https://public-bucket.s3.amazonaws.com/*");
            assert_eq!(format, "CSV");
            assert_eq!(aws_access_key_id, None);
            assert_eq!(aws_secret_access_key, None);
        } else {
            panic!("Expected S3Queue engine");
        }
    }

    #[test]
    fn test_s3queue_parsing_with_nosign_and_compression() {
        let engine_str =
            "S3Queue('https://public-bucket.s3.amazonaws.com/*', NOSIGN, 'CSV', 'gzip')";
        let result = ClickhouseEngine::try_from(engine_str);
        assert!(result.is_ok());

        if let Ok(ClickhouseEngine::S3Queue {
            s3_path,
            format,
            compression,
            aws_access_key_id,
            aws_secret_access_key,
            ..
        }) = result
        {
            assert_eq!(s3_path, "https://public-bucket.s3.amazonaws.com/*");
            assert_eq!(format, "CSV");
            assert_eq!(compression, Some("gzip".to_string()));
            assert_eq!(aws_access_key_id, None);
            assert_eq!(aws_secret_access_key, None);
        } else {
            panic!("Expected S3Queue engine");
        }
    }

    #[test]
    fn test_parse_quoted_csv() {
        // Test basic parsing
        assert_eq!(
            parse_quoted_csv("'value1', 'value2'"),
            vec!["value1", "value2"]
        );

        // Test with spaces
        assert_eq!(
            parse_quoted_csv("  'value1'  ,  'value2'  "),
            vec!["value1", "value2"]
        );

        // Test with null values
        assert_eq!(
            parse_quoted_csv("'value1', null, 'value3'"),
            vec!["value1", "null", "value3"]
        );

        // Test with escaped quotes
        assert_eq!(
            parse_quoted_csv("'value1', 'val\\'ue2'"),
            vec!["value1", "val'ue2"]
        );

        // Test with JSON containing quotes
        assert_eq!(
            parse_quoted_csv("'path', 'format', null, '{\"key\": \"val\\'ue\"}'"),
            vec!["path", "format", "null", "{\"key\": \"val'ue\"}"]
        );

        // Test empty string
        assert_eq!(parse_quoted_csv(""), Vec::<String>::new());

        // Test single value
        assert_eq!(parse_quoted_csv("'single'"), vec!["single"]);
    }

    #[test]
    fn test_s3queue_serialization() {
        // Test with all parameters
        let mut headers = std::collections::HashMap::new();
        headers.insert("x-custom".to_string(), "value".to_string());

        let result = ClickhouseEngine::serialize_s3queue(
            "s3://bucket/path",
            "JSONEachRow",
            &Some("gzip".to_string()),
            &Some(headers),
        );

        assert!(result.starts_with("S3Queue('s3://bucket/path', 'JSONEachRow', 'gzip',"));
        assert!(result.contains("x-custom"));

        // Test with minimal parameters
        let minimal = ClickhouseEngine::serialize_s3queue("s3://bucket/data", "CSV", &None, &None);

        assert_eq!(minimal, "S3Queue('s3://bucket/data', 'CSV', null, null)");

        // Test with special characters in path
        let special = ClickhouseEngine::serialize_s3queue(
            "s3://bucket/path with spaces/*.json",
            "JSONEachRow",
            &None,
            &None,
        );

        assert_eq!(
            special,
            "S3Queue('s3://bucket/path with spaces/*.json', 'JSONEachRow', null, null)"
        );
    }

    #[test]
    fn test_s3queue_display_with_credentials() {
        let engine = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/data/*.json".to_string(),
            format: "JSONEachRow".to_string(),
            compression: None,
            headers: None,
            aws_access_key_id: Some("AKIAIOSFODNN7EXAMPLE".to_string()),
            aws_secret_access_key: Some("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string()),
        };
        let display: String = engine.into();
        assert!(display.contains("auth='AKIAIOSFODNN7EXAMPLE:wJal...EKEY'"));
        assert!(display.contains("S3Queue('s3://bucket/data/*.json', 'JSONEachRow'"));
    }

    #[test]
    fn test_s3queue_display_without_credentials() {
        let engine = ClickhouseEngine::S3Queue {
            s3_path: "s3://public-bucket/data/*.csv".to_string(),
            format: "CSV".to_string(),
            compression: Some("gzip".to_string()),
            headers: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };
        let display: String = engine.into();
        assert!(display.contains("auth=NOSIGN"));
        assert!(display.contains("compression='gzip'"));
        assert!(display.contains("S3Queue('s3://public-bucket/data/*.csv', 'CSV'"));
    }

    #[test]
    fn test_s3queue_display_with_headers() {
        let mut headers = std::collections::HashMap::new();
        headers.insert("x-custom".to_string(), "value".to_string());
        headers.insert("x-another".to_string(), "test".to_string());

        let engine = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/path/*.json".to_string(),
            format: "JSON".to_string(),
            compression: None,
            headers: Some(headers),
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };
        let display: String = engine.into();
        assert!(display.contains("headers_count=2"));
        assert!(display.contains("auth=NOSIGN"));
    }

    #[test]
    fn test_s3queue_parsing() {
        // Test basic parsing
        let engine = ClickhouseEngine::parse_s3queue("'s3://bucket/path', 'JSONEachRow'").unwrap();
        match engine {
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                headers,
                ..
            } => {
                assert_eq!(s3_path, "s3://bucket/path");
                assert_eq!(format, "JSONEachRow");
                assert_eq!(compression, None);
                assert_eq!(headers, None);
            }
            _ => panic!("Expected S3Queue"),
        }

        // Test with compression
        let with_comp =
            ClickhouseEngine::parse_s3queue("'s3://bucket/path', 'CSV', 'gzip', null").unwrap();
        match with_comp {
            ClickhouseEngine::S3Queue { compression, .. } => {
                assert_eq!(compression, Some("gzip".to_string()));
            }
            _ => panic!("Expected S3Queue"),
        }

        // Test with headers
        let with_headers = ClickhouseEngine::parse_s3queue(
            "'s3://bucket/path', 'JSON', null, '{\"x-custom\": \"value\"}'",
        )
        .unwrap();
        match with_headers {
            ClickhouseEngine::S3Queue { headers, .. } => {
                assert!(headers.is_some());
                let hdrs = headers.unwrap();
                assert_eq!(hdrs.get("x-custom"), Some(&"value".to_string()));
            }
            _ => panic!("Expected S3Queue"),
        }

        // Test error case - missing format
        let err = ClickhouseEngine::parse_s3queue("'s3://bucket/path'");
        assert!(err.is_err());
    }

    #[test]
    fn test_s3queue_engine_round_trip() {
        // Test case 1: Full parameters with compression and headers
        let mut headers1 = std::collections::HashMap::new();
        headers1.insert("x-custom-header".to_string(), "value1".to_string());
        headers1.insert("authorization".to_string(), "Bearer token".to_string());

        let engine1 = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/path/*.json".to_string(),
            format: "JSONEachRow".to_string(),
            compression: Some("gzip".to_string()),
            headers: Some(headers1.clone()),
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };

        let serialized1 = engine1.to_proto_string();
        let deserialized1 = ClickhouseEngine::try_from(serialized1.as_str()).unwrap();

        match deserialized1 {
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                headers,
                ..
            } => {
                assert_eq!(s3_path, "s3://bucket/path/*.json");
                assert_eq!(format, "JSONEachRow");
                assert_eq!(compression, Some("gzip".to_string()));
                assert!(headers.is_some());
                let hdrs = headers.unwrap();
                assert_eq!(hdrs.len(), 2);
                assert_eq!(hdrs.get("x-custom-header"), Some(&"value1".to_string()));
                assert_eq!(hdrs.get("authorization"), Some(&"Bearer token".to_string()));
            }
            _ => panic!("Expected S3Queue engine"),
        }

        // Test case 2: Minimal parameters
        let engine2 = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/data".to_string(),
            format: "CSV".to_string(),
            compression: None,
            headers: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };

        let serialized2 = engine2.to_proto_string();
        assert_eq!(
            serialized2,
            "S3Queue('s3://bucket/data', 'CSV', null, null)"
        );

        let deserialized2 = ClickhouseEngine::try_from(serialized2.as_str()).unwrap();
        match deserialized2 {
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                headers,
                ..
            } => {
                assert_eq!(s3_path, "s3://bucket/data");
                assert_eq!(format, "CSV");
                assert_eq!(compression, None);
                assert_eq!(headers, None);
            }
            _ => panic!("Expected S3Queue engine"),
        }

        // Test case 3: Path with special characters
        let engine3 = ClickhouseEngine::S3Queue {
            s3_path: "s3://my-bucket/data/year=2024/month=01/*.parquet".to_string(),
            format: "Parquet".to_string(),
            compression: Some("snappy".to_string()),
            headers: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };

        let serialized3 = engine3.to_proto_string();
        let deserialized3 = ClickhouseEngine::try_from(serialized3.as_str()).unwrap();

        match deserialized3 {
            ClickhouseEngine::S3Queue {
                s3_path,
                format,
                compression,
                ..
            } => {
                assert_eq!(s3_path, "s3://my-bucket/data/year=2024/month=01/*.parquet");
                assert_eq!(format, "Parquet");
                assert_eq!(compression, Some("snappy".to_string()));
            }
            _ => panic!("Expected S3Queue engine"),
        }

        // Test case 4: Headers with quotes and special characters
        let mut headers4 = std::collections::HashMap::new();
        headers4.insert("x-meta".to_string(), "value with 'quotes'".to_string());

        let engine4 = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/test".to_string(),
            format: "JSON".to_string(),
            compression: None,
            headers: Some(headers4),
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };

        let serialized4 = engine4.to_proto_string();
        let deserialized4 = ClickhouseEngine::try_from(serialized4.as_str()).unwrap();

        match deserialized4 {
            ClickhouseEngine::S3Queue { headers, .. } => {
                assert!(headers.is_some());
                let hdrs = headers.unwrap();
                assert_eq!(hdrs.get("x-meta"), Some(&"value with 'quotes'".to_string()));
            }
            _ => panic!("Expected S3Queue engine"),
        }
    }

    #[test]
    fn test_s3queue_with_settings_preservation() {
        // Verify that settings are preserved separately from serialization
        let mut settings = std::collections::HashMap::new();
        settings.insert("mode".to_string(), "ordered".to_string());
        settings.insert("keeper_path".to_string(), "/clickhouse/s3".to_string());

        let engine = ClickhouseEngine::S3Queue {
            s3_path: "s3://bucket/path".to_string(),
            format: "JSONEachRow".to_string(),
            compression: None,
            headers: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
        };

        // Serialize (settings are NOT included in the string representation)
        let serialized = engine.to_proto_string();
        assert_eq!(
            serialized,
            "S3Queue('s3://bucket/path', 'JSONEachRow', null, null)"
        );

        // When deserializing, settings come back empty
        let deserialized = ClickhouseEngine::try_from(serialized.as_str()).unwrap();
        match &deserialized {
            ClickhouseEngine::S3Queue { .. } => {
                // Settings are now in table_settings, not in the engine
            }
            _ => panic!("Expected S3Queue"),
        }
    }

    #[test]
    fn test_create_table_query_s3queue_without_settings() {
        let table = ClickHouseTable {
            version: Some(Version::from_string("1".to_string())),
            name: "test_table".to_string(),
            columns: vec![ClickHouseColumn {
                name: "id".to_string(),
                column_type: ClickHouseColumnType::ClickhouseInt(ClickHouseInt::Int32),
                required: true,
                primary_key: true,
                unique: false,
                default: None,
                comment: None,
            }],
            order_by: vec![],
            engine: ClickhouseEngine::S3Queue {
                s3_path: "s3://my-bucket/data/*.csv".to_string(),
                format: "CSV".to_string(),
                compression: None,
                headers: None,
                aws_access_key_id: None,
                aws_secret_access_key: None,
            },
            table_settings: None,
        };

        let query = create_table_query("test_db", table).unwrap();
        let expected = r#"
CREATE TABLE IF NOT EXISTS `test_db`.`test_table`
(
 `id` Int32 NOT NULL
)
ENGINE = S3Queue('s3://my-bucket/data/*.csv', NOSIGN, 'CSV')
PRIMARY KEY (`id`)"#;
        assert_eq!(query.trim(), expected.trim());
    }

    #[test]
    fn test_hash_consistency() {
        // Test that the same engine produces the same hash multiple times
        let engine1 = ClickhouseEngine::S3Queue {
            s3_path: "s3://test-bucket/data/*.json".to_string(),
            format: "JSONEachRow".to_string(),
            compression: Some("gzip".to_string()),
            headers: None,
            aws_access_key_id: Some("test-key".to_string()),
            aws_secret_access_key: Some("test-secret".to_string()),
        };

        let engine2 = ClickhouseEngine::S3Queue {
            s3_path: "s3://test-bucket/data/*.json".to_string(),
            format: "JSONEachRow".to_string(),
            compression: Some("gzip".to_string()),
            headers: None,
            aws_access_key_id: Some("test-key".to_string()),
            aws_secret_access_key: Some("test-secret".to_string()),
        };

        let hash1 = engine1.non_alterable_params_hash();
        let hash2 = engine2.non_alterable_params_hash();

        // Hashes should be identical for identical engines
        assert_eq!(hash1, hash2);

        // Hash should be a valid hex string (64 characters for SHA256)
        assert_eq!(hash1.len(), 64);
        assert!(hash1.chars().all(|c| c.is_ascii_hexdigit()));

        // Test different engines produce different hashes
        let merge_tree = ClickhouseEngine::MergeTree;
        let merge_tree_hash = merge_tree.non_alterable_params_hash();
        assert_ne!(hash1, merge_tree_hash);
    }
}
