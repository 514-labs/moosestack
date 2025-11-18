//! JSON serialization utilities
//!
//! Provides sorted-key JSON serialization for deterministic output.
//!
//! ## Why sorted keys?
//!
//! Migration files (`remote_state.json`, `local_infra_map.json`, `plan.yaml`) are
//! committed to version control. Without sorted keys, HashMaps serialize in random
//! order, causing noisy diffs even when nothing changed semantically.
//!
//! Rust's `serde_json` doesn't provide native sorted serialization, so we implement
//! it here rather than adding a dependency for this single use case.

use serde::Serialize;
use serde_json::{Map, Value};

/// Recursively sorts all object keys in a JSON value
///
/// This function traverses a JSON value tree and converts all objects
/// (maps) to use sorted keys. Arrays and primitive values are preserved as-is.
///
/// # Arguments
/// * `value` - The JSON value to sort
///
/// # Returns
/// A new JSON value with all object keys sorted alphabetically
pub fn sort_json_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted_map = Map::new();
            // Collect keys and sort them
            let mut keys: Vec<String> = map.keys().cloned().collect();
            keys.sort();

            // Insert values in sorted key order, recursively sorting nested values
            for key in keys {
                if let Some(val) = map.get(&key) {
                    sorted_map.insert(key, sort_json_keys(val.clone()));
                }
            }
            Value::Object(sorted_map)
        }
        Value::Array(arr) => {
            // Recursively sort keys in array elements, but don't sort the array itself
            Value::Array(arr.into_iter().map(sort_json_keys).collect())
        }
        // Primitive values pass through unchanged
        other => other,
    }
}

/// Serializes a value to a pretty-printed JSON string with sorted keys
///
/// This function is a drop-in replacement for `serde_json::to_string_pretty`
/// that ensures all object keys are sorted alphabetically for consistent output.
///
/// # Arguments
/// * `value` - Any serializable value
///
/// # Returns
/// A Result containing the pretty-printed JSON string with sorted keys,
/// or a serialization error
///
/// # Examples
/// ```ignore
/// use crate::utilities::json::to_string_pretty_sorted;
///
/// let data = MyStruct { ... };
/// let json = to_string_pretty_sorted(&data)?;
/// std::fs::write("output.json", json)?;
/// ```
pub fn to_string_pretty_sorted<T: Serialize>(value: &T) -> serde_json::Result<String> {
    // First serialize to a JSON value
    let json_value = serde_json::to_value(value)?;

    // Sort all keys recursively
    let sorted_value = sort_json_keys(json_value);

    // Serialize to pretty string
    serde_json::to_string_pretty(&sorted_value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_sort_simple_object() {
        let input = json!({
            "zebra": 1,
            "apple": 2,
            "mango": 3
        });

        let sorted = sort_json_keys(input);
        let output = serde_json::to_string(&sorted).unwrap();

        // Keys should be in alphabetical order
        assert!(output.find("apple").unwrap() < output.find("mango").unwrap());
        assert!(output.find("mango").unwrap() < output.find("zebra").unwrap());
    }

    #[test]
    fn test_sort_nested_objects() {
        let input = json!({
            "outer_z": {
                "inner_z": 1,
                "inner_a": 2
            },
            "outer_a": {
                "inner_z": 3,
                "inner_a": 4
            }
        });

        let sorted = sort_json_keys(input);
        let output = serde_json::to_string(&sorted).unwrap();

        // Outer keys should be sorted
        assert!(output.find("outer_a").unwrap() < output.find("outer_z").unwrap());
    }

    #[test]
    fn test_arrays_preserve_order() {
        let input = json!({
            "items": [
                {"name": "zebra", "id": 1},
                {"name": "apple", "id": 2}
            ]
        });

        let sorted = sort_json_keys(input);

        // Array order should be preserved
        if let Value::Object(map) = &sorted {
            if let Some(Value::Array(items)) = map.get("items") {
                assert_eq!(items.len(), 2);
                assert_eq!(items[0]["id"], 1); // zebra still first
                assert_eq!(items[1]["id"], 2); // apple still second
            } else {
                panic!("Expected array");
            }
        } else {
            panic!("Expected object");
        }
    }

    #[test]
    fn test_to_string_pretty_sorted() {
        use serde::Serialize;
        use std::collections::HashMap;

        #[derive(Serialize)]
        struct TestStruct {
            zebra: String,
            apple: String,
            mango: HashMap<String, i32>,
        }

        let mut map = HashMap::new();
        map.insert("z_key".to_string(), 1);
        map.insert("a_key".to_string(), 2);

        let test_data = TestStruct {
            zebra: "last".to_string(),
            apple: "first".to_string(),
            mango: map,
        };

        let output = to_string_pretty_sorted(&test_data).unwrap();

        // apple should appear before zebra in the output
        assert!(output.find("apple").unwrap() < output.find("zebra").unwrap());

        // Nested keys should also be sorted
        assert!(output.find("a_key").unwrap() < output.find("z_key").unwrap());
    }
}
