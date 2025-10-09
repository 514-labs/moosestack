# MCP Tool Interface Standard

This document defines the standard interface that all MCP tools must implement for consistency and maintainability.

## Overview

Each tool is a self-contained module that exposes a standard interface. The MCP server (`server.rs`) simply orchestrates these tools without knowing their internal implementation details.

## Required Public Functions

Every tool module must expose these two public functions:

### 1. `tool_definition() -> Tool`

Returns the complete tool definition including:
- Tool name
- Description
- Input schema (JSON Schema)
- Optional metadata (title, icons, etc.)

**Example:**
```rust
pub fn tool_definition() -> Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "param1": {
                "type": "string",
                "description": "First parameter"
            }
        }
    });

    Tool {
        name: "my_tool".into(),
        description: Some("Tool description".into()),
        input_schema: Arc::new(schema.as_object().unwrap().clone()),
        annotations: None,
        icons: None,
        output_schema: None,
        title: Some("My Tool".into()),
    }
}
```

### 2. `handle_call(arguments: Option<&Map<String, Value>>) -> CallToolResult`

Handles the actual tool invocation:
- Parses and validates input parameters
- Executes the tool's logic
- Returns a properly formatted result

**Example:**
```rust
pub fn handle_call(arguments: Option<&Map<String, Value>>) -> CallToolResult {
    // 1. Parse and validate parameters
    let params = match parse_params(arguments) {
        Ok(p) => p,
        Err(e) => {
            return CallToolResult {
                content: vec![Annotated {
                    raw: RawContent::Text(RawTextContent {
                        text: format!("Parameter validation error: {}", e),
                        meta: None,
                    }),
                    annotations: None,
                }],
                is_error: Some(true),
                meta: None,
                structured_content: None,
            };
        }
    };

    // 2. Execute tool logic
    match execute_tool(params) {
        Ok(result) => CallToolResult {
            content: vec![Annotated {
                raw: RawContent::Text(RawTextContent {
                    text: result,
                    meta: None,
                }),
                annotations: None,
            }],
            is_error: Some(false),
            meta: None,
            structured_content: None,
        },
        Err(e) => CallToolResult {
            content: vec![Annotated {
                raw: RawContent::Text(RawTextContent {
                    text: format!("Error: {}", e),
                    meta: None,
                }),
                annotations: None,
            }],
            is_error: Some(true),
            meta: None,
            structured_content: None,
        },
    }
}
```

## Internal Organization

### Parameter Validation

Each tool should have an internal `parse_params()` function that:
- Extracts parameters from the `Map<String, Value>`
- Validates parameter types and ranges
- Returns a strongly-typed params struct or an error

```rust
fn parse_params(arguments: Option<&Map<String, Value>>) -> Result<MyToolParams, MyToolError> {
    let args = arguments;
    
    let param1 = args
        .and_then(|v| v.get("param1"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| MyToolError::InvalidParameter("param1 is required".into()))?;
    
    // Validate
    if param1.is_empty() {
        return Err(MyToolError::InvalidParameter("param1 cannot be empty".into()));
    }
    
    Ok(MyToolParams { param1: param1.to_string() })
}
```

### Error Handling

Use `thiserror` for error definitions:

```rust
#[derive(Debug, thiserror::Error)]
pub enum MyToolError {
    #[error("Failed to read file: {0}")]
    FileRead(#[from] std::io::Error),
    
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}
```

### Private Implementation

The actual tool logic should be in private functions:

```rust
fn execute_tool(params: MyToolParams) -> Result<String, MyToolError> {
    // Tool implementation here
    Ok("result".to_string())
}
```

## Integrating with the Server

To add a new tool to the MCP server:

### 1. Create the tool module

```rust
// In src/mcp/tools/my_tool.rs
pub fn tool_definition() -> Tool { ... }
pub fn handle_call(arguments: Option<&Map<String, Value>>) -> CallToolResult { ... }
```

### 2. Export from tools module

```rust
// In src/mcp/tools/mod.rs
pub mod my_tool;
```

### 3. Register in server

```rust
// In src/mcp/server.rs
use super::tools::{logs, my_tool};

async fn list_tools(...) -> Result<ListToolsResult, ErrorData> {
    Ok(ListToolsResult {
        tools: vec![
            logs::tool_definition(),
            my_tool::tool_definition(),  // Add here
        ],
        next_cursor: None,
    })
}

async fn call_tool(...) -> Result<CallToolResult, ErrorData> {
    match param.name.as_ref() {
        "get_logs" => Ok(logs::handle_call(param.arguments.as_ref())),
        "my_tool" => Ok(my_tool::handle_call(param.arguments.as_ref())),  // Add here
        _ => Ok(/* unknown tool error */),
    }
}
```

## Best Practices

1. **Keep tools self-contained**: All validation, schema, and logic in one module
2. **Validate early**: Check all parameters before executing logic
3. **Provide helpful errors**: Include context about what went wrong
4. **Use the schema**: JSON Schema should match what `parse_params()` expects
5. **Test thoroughly**: Unit tests for parsing, validation, and execution
6. **Document parameters**: Clear descriptions in the JSON Schema

## Example: Complete Tool

See `apps/framework-cli/src/mcp/tools/logs.rs` for a complete, production-ready example implementing this interface.

