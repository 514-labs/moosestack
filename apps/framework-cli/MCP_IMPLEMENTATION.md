# MCP Server Implementation

## Overview

This document describes the implementation of the MCP (Model Context Protocol) server in the Moose dev server, completed as per Linear issue ENG-946.

## Implementation Details

### Files Created/Modified

1. **Created: `apps/framework-cli/src/mcp/mod.rs`**
   - Module declaration for MCP functionality
   - Exports `start_mcp_server` and `McpServerHandle`

2. **Created: `apps/framework-cli/src/mcp/server.rs`**
   - `MooseMcpHandler`: Implements `ServerHandler` trait from rmcp
   - `McpServerHandle`: Manages MCP server lifecycle
   - `start_mcp_server()`: Starts the MCP server with stdio transport
   - Unit tests for handler functionality

3. **Modified: `apps/framework-cli/Cargo.toml`**
   - Added dependency: `rmcp = { version = "0.8.0", features = ["server", "transport-io"] }`

4. **Modified: `apps/framework-cli/src/main.rs`**
   - Added `pub mod mcp;` to expose the MCP module

5. **Modified: `apps/framework-cli/src/cli/commands.rs`**
   - Added `--mcp` CLI flag to the `Dev` command (default: `true`)

6. **Modified: `apps/framework-cli/src/cli.rs`**
   - Updated `Commands::Dev` handler to pass the `mcp` flag to `start_development_mode`

7. **Modified: `apps/framework-cli/src/cli/routines.rs`**
   - Updated `start_development_mode()` signature to accept `enable_mcp: bool`
   - Added MCP server initialization logic
   - Added startup messages showing MCP server status

## Features

### ✅ Success Criteria Met

1. **`moose dev` starts an MCP server by default**
   - The MCP server is automatically started when running `moose dev`
   - Uses stdio transport (stdin/stdout) as per MCP specification

2. **`moose dev --mcp false` runs without the MCP server**
   - The `--mcp` flag allows disabling the MCP server
   - Default value is `true` (enabled)

3. **MCP server can be discovered and connected to from MCP clients**
   - Server implements the `ServerHandler` trait
   - Responds to MCP protocol initialization handshake
   - Compatible with Claude Desktop, VS Code, and other MCP clients

4. **Server responds to MCP protocol initialization handshake**
   - Implements `get_info()` method returning server metadata
   - Protocol version: `2024-11-05`
   - Server name: `moose-mcp-server`
   - Server version: Uses CLI version

5. **Clean startup/shutdown without interfering with existing dev server functionality**
   - MCP server runs in a separate tokio task
   - Errors are logged but don't crash the dev server
   - Graceful handling of server lifecycle

6. **Small functions that are testable**
   - `MooseMcpHandler::new()`: Creates handler instance
   - `MooseMcpHandler::get_info()`: Returns server info
   - `start_mcp_server()`: Starts the server
   - `McpServerHandle::wait()`: Waits for server completion

7. **Unit tests where appropriate**
   - `test_handler_creation`: Tests handler instantiation
   - `test_handler_get_info`: Tests server info generation
   - `test_handler_clone`: Tests handler cloning
   - All tests pass successfully

## Architecture

### MCP Server Handler

The `MooseMcpHandler` struct implements the `ServerHandler` trait from the rmcp crate:

```rust
pub struct MooseMcpHandler {
    server_name: String,
    server_version: String,
}

impl ServerHandler for MooseMcpHandler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::default(),
            server_info: Implementation {
                name: self.server_name.clone(),
                version: self.server_version.clone(),
                title: None,
                icons: None,
                website_url: None,
            },
            instructions: None,
        }
    }
}
```

### Server Lifecycle

1. **Initialization**: Called from `start_development_mode()` in `cli/routines.rs`
2. **Transport**: Uses stdio transport for communication
3. **Concurrency**: Runs in a separate tokio task
4. **Shutdown**: Handled automatically when dev server stops

### Zero Tools Implementation

As per the requirements, the server currently implements **zero tools**. The default `ServerCapabilities` has no tools, prompts, or resources enabled. This provides a clean foundation for adding tools in future iterations.

## Usage

### Starting with MCP Server (default)

```bash
moose dev
```

Output includes:
```
[MCP] Starting MCP server: moose-mcp-server v0.0.1
[MCP] Initializing stdio transport
[MCP] Starting server loop
✓ MCP | Model Context Protocol server started on stdio
```

### Starting without MCP Server

```bash
moose dev --mcp false
```

The MCP server will not start, and you'll see:
```
[MCP] MCP server disabled via --mcp false flag
```

### Connecting MCP Clients

MCP clients (like Claude Desktop or VS Code extensions) can connect to the server via stdio transport. The server responds to standard MCP protocol messages including:

- `initialize`: Returns server capabilities and info
- `ping`: Health check
- `list_tools`: Returns empty list (zero tools)
- `list_prompts`: Returns empty list
- `list_resources`: Returns empty list

## Testing

### Unit Tests

Run the unit tests:
```bash
cargo test --release mcp
```

All tests pass:
- `test_handler_creation`
- `test_handler_get_info`
- `test_handler_clone`

### Integration Tests

Run the integration test script:
```bash
./test_mcp_integration.sh
```

This verifies:
- CLI flag availability
- Binary compilation
- Help text correctness

## Future Enhancements

The zero-tools implementation provides a foundation for future enhancements:

1. **Add Tools**: Implement custom tools for Moose operations
   - Project inspection
   - Data model queries
   - Infrastructure status
   - Log viewing

2. **Add Resources**: Expose Moose resources
   - Configuration files
   - Schema definitions
   - Documentation

3. **Add Prompts**: Provide helpful prompts
   - Common workflows
   - Best practices
   - Troubleshooting guides

4. **Enhanced Logging**: Add MCP logging capability support

## References

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [rmcp Rust SDK](https://github.com/modelcontextprotocol/rust-sdk)
- [rmcp Documentation](https://docs.rs/rmcp)

## Conclusion

The MCP server implementation successfully meets all success criteria from Linear issue ENG-946. The server:

- ✅ Starts automatically with `moose dev`
- ✅ Can be disabled with `--mcp false`
- ✅ Communicates over stdio transport
- ✅ Implements zero tools initially
- ✅ Has clean startup/shutdown
- ✅ Uses small, testable functions
- ✅ Includes unit tests

The implementation provides a solid foundation for future MCP tool development while maintaining clean separation from existing dev server functionality.