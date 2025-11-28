//! TOON format serialization utilities for MCP tool responses
//!
//! This module provides functions to serialize JSON data to TOON format,
//! optimized for compression to reduce token usage when transmitting data
//! to Large Language Models through the Model Context Protocol.

use serde_json::Value;
use toon_format::types::KeyFoldingMode;
use toon_format::{encode, encode_default, EncodeOptions};

/// Errors that can occur during TOON serialization
#[derive(Debug, thiserror::Error)]
pub enum ToonSerializationError {
    #[error("failed to encode data to TOON format: {message}")]
    EncodingError { message: String },
}

/// Serialize a JSON value to TOON format with compression optimization
///
/// Uses key folding to collapse nested object chains for better compression.
/// This is the recommended encoding method for large data payloads.
///
/// # Arguments
/// * `value` - The JSON value to serialize
///
/// # Returns
/// * `Ok(String)` - TOON-formatted string
/// * `Err(ToonSerializationError)` - If encoding fails
///
/// # Example
/// ```rust
/// let data = json!({"users": [{"id": 1, "name": "Alice"}]});
/// let toon_str = serialize_to_toon_compressed(&data)?;
/// ```
pub fn serialize_to_toon_compressed(value: &Value) -> Result<String, ToonSerializationError> {
    let options = EncodeOptions::new()
        .with_key_folding(KeyFoldingMode::Safe) // Enable key folding for compression
        .with_spaces(2); // Standard indentation

    encode(value, &options).map_err(|e| ToonSerializationError::EncodingError {
        message: e.to_string(),
    })
}

/// Serialize a JSON value to TOON format with default settings
///
/// Uses standard TOON encoding without advanced compression features.
/// Suitable for smaller payloads or when key folding is not desired.
///
/// # Arguments
/// * `value` - The JSON value to serialize
///
/// # Returns
/// * `Ok(String)` - TOON-formatted string
/// * `Err(ToonSerializationError)` - If encoding fails
#[allow(dead_code)]
pub fn serialize_to_toon_default(value: &Value) -> Result<String, ToonSerializationError> {
    encode_default(value).map_err(|e| ToonSerializationError::EncodingError {
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_serialize_simple_object() {
        let data = json!({
            "name": "Alice",
            "age": 30
        });

        let result = serialize_to_toon_compressed(&data);
        assert!(result.is_ok());

        let toon_str = result.unwrap();
        assert!(toon_str.contains("name"));
        assert!(toon_str.contains("age"));
    }

    #[test]
    fn test_serialize_array() {
        let data = json!({
            "users": [
                {"id": 1, "name": "Alice"},
                {"id": 2, "name": "Bob"}
            ]
        });

        let result = serialize_to_toon_compressed(&data);
        assert!(result.is_ok());

        let toon_str = result.unwrap();
        assert!(toon_str.contains("users"));
    }

    #[test]
    fn test_serialize_nested_objects() {
        let data = json!({
            "data": {
                "metadata": {
                    "count": 10
                }
            }
        });

        let result = serialize_to_toon_compressed(&data);
        assert!(result.is_ok());

        // Key folding should compress nested single-key chains
        let toon_str = result.unwrap();
        assert!(toon_str.contains("data"));
    }

    #[test]
    fn test_serialize_with_null() {
        let data = json!({
            "value": null,
            "number": 42
        });

        let result = serialize_to_toon_compressed(&data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_serialize_empty_object() {
        let data = json!({});

        let result = serialize_to_toon_compressed(&data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_serialize_empty_array() {
        let data = json!([]);

        let result = serialize_to_toon_compressed(&data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_serialize_default_vs_compressed() {
        let data = json!({
            "nested": {
                "object": {
                    "value": 123
                }
            }
        });

        let default_result = serialize_to_toon_default(&data);
        let compressed_result = serialize_to_toon_compressed(&data);

        assert!(default_result.is_ok());
        assert!(compressed_result.is_ok());

        // Both should produce valid TOON, but compressed may be shorter
        let default_str = default_result.unwrap();
        let compressed_str = compressed_result.unwrap();

        assert!(default_str.len() >= compressed_str.len());
    }
}
