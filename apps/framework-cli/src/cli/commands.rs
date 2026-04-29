//! # CLI Commands
//! A module for all the commands that can be run from the CLI

use std::path::PathBuf;

use clap::{ArgGroup, Args, Subcommand};

const MOOSE_INIT_AFTER_LONG_HELP: &str = "Examples (preferred):
  moose init --name my-app
  moose init --name my-app --template typescript
  moose init --name my-app --template=typescript
  moose init --name my-app --template typescript --location ./sandbox
  moose init --name my-project --template typescript-empty --from-remote <CONNECTION-STRING>
  moose init --name my-project --template python-empty --from-remote

Positional <NAME> and [TEMPLATE] are still accepted for backward compatibility but are hidden from
this help output; prefer --name and --template in scripts and agent workflows.

Template catalog:
  moose template list
  moose template list --json

Arg-driven init is non-interactive when --template is provided, or when stdin is not a terminal:
omitted --template in other cases will prompt to select a template (TTY only).";

#[derive(Subcommand)]
pub enum Commands {
    // Initializes the developer environment with all the necessary directories including temporary ones for data storage
    /// Initialize a new project
    #[command(
        visible_alias = "i",
        after_long_help = MOOSE_INIT_AFTER_LONG_HELP,
        group(
            ArgGroup::new("init_project_name")
                .id("init_project_name")
                .args(["name", "name_option"])
                .required(true)
        ),
        group(
            ArgGroup::new("init_template_input")
                .id("init_template_input")
                .args(["template", "template_option"])
        )
    )]
    Init {
        /// [Deprecated] Use `--name` instead. Hidden from help; still parsed for compatibility.
        #[arg(hide = true)]
        name: Option<String>,

        /// Name of your app or service
        #[arg(long = "name", value_name = "NAME", conflicts_with = "name")]
        name_option: Option<String>,

        /// [Deprecated] Use `--template` instead. Hidden from help; still parsed for compatibility.
        #[arg(hide = true, conflicts_with = "template_option")]
        template: Option<String>,

        /// Template to use (run `moose template list` to see the catalog). Omit to select interactively (TTY only)
        #[arg(
            long = "template",
            value_name = "TEMPLATE",
            conflicts_with = "template"
        )]
        template_option: Option<String>,

        /// Location of your app or service
        #[arg(short, long)]
        location: Option<String>,

        /// Allow init in an existing directory
        #[arg(long)]
        no_fail_already_exists: bool,

        /// Initialize from a remote database
        #[arg(
            long,
            value_name = "CONNECTION_STRING",
            num_args = 0..=1
        )]
        from_remote: Option<Option<String>>,

        /// Generate a custom Dockerfile at project root
        #[arg(long)]
        custom_dockerfile: bool,
    },
    /// Build your moose project
    #[command(visible_alias = "b")]
    Build {
        /// Build for Docker
        #[arg(short, long, default_value = "false")]
        docker: bool,
        /// Build for amd64 architecture
        #[arg(long)]
        amd64: bool,
        /// Build for arm64 architecture
        #[arg(long)]
        arm64: bool,
    },
    /// Check the project for non-runtime errors
    #[command(visible_alias = "c")]
    Check {
        /// Write the infrastructure map to disk
        #[arg(long, default_value = "false")]
        write_infra_map: bool,
    },
    /// Preview infrastructure changes for next deployment
    #[command(visible_alias = "pl")]
    Plan {
        /// URL of the remote Moose instance (default: http://localhost:4000)
        #[arg(long, conflicts_with = "clickhouse_url")]
        url: Option<String>,

        /// API token for the remote Moose instance
        #[arg(long)]
        token: Option<String>,

        /// ClickHouse connection URL for serverless deployments
        #[arg(long, conflicts_with = "url")]
        clickhouse_url: Option<String>,

        /// Output plan as JSON
        #[arg(long)]
        json: bool,
    },

    /// Execute a migration plan against a remote ClickHouse database
    #[command(visible_alias = "mg")]
    Migrate {
        /// ClickHouse connection URL (e.g., clickhouse://user:pass@host:port/database or https://user:pass@host:port/database)
        /// Authentication credentials should be included in the URL
        #[arg(long)]
        clickhouse_url: Option<String>,

        /// Redis connection URL for state storage
        #[arg(long)]
        redis_url: Option<String>,

        /// Validate migration files without executing them.
        /// Checks that the delta sequence is consistent (fold succeeds)
        /// and detects semantic conflicts between migration files.
        /// Does not require ClickHouse or Redis.
        #[arg(long)]
        validate: bool,
    },

    /// View some data from a table or stream
    #[command(visible_alias = "pk")]
    Peek {
        /// Name of the table or stream to peek
        name: String,
        /// Limit the number of rows to view
        #[arg(short, long, default_value = "5")]
        limit: u8,
        /// Output to a file
        #[arg(short, long)]
        file: Option<PathBuf>,

        /// View data from a table
        #[arg(short = 't', long = "table", group = "resource_type")]
        table: bool,

        /// View data from a stream/topic
        #[arg(short = 's', long = "stream", group = "resource_type")]
        stream: bool,
    },
    /// Start a local development environment
    #[command(visible_alias = "d")]
    Dev {
        /// Skip starting local infrastructure
        #[arg(long)]
        no_infra: bool,

        /// Enable or disable the MCP (Model Context Protocol) server
        #[arg(long, default_value = "true")]
        mcp: bool,

        /// Show HH:MM:SS.mmm timestamps on all output lines
        #[arg(long)]
        timestamps: bool,

        /// Show elapsed time for operations (e.g., "completed in 234ms")
        #[arg(long)]
        timing: bool,

        /// Log payloads at ingest API and streaming functions for debugging
        #[arg(long)]
        log_payloads: bool,

        /// Skip all confirmation prompts
        #[arg(long)]
        yes_all: bool,

        /// Auto-approve destructive operations
        #[arg(long)]
        yes_destructive: bool,

        /// Auto-approve column renames
        #[arg(long)]
        yes_rename: bool,

        /// Agent-driven mode: confirmation prompts are answered via the MCP
        /// `respond_to_prompt` tool instead of stdin. Implies --mcp.
        #[arg(long)]
        agent: bool,

        /// Use native binaries for ClickHouse and Temporal instead of Docker
        #[arg(long)]
        dockerless: bool,
    },
    /// Start a production environment
    #[command(visible_alias = "p")]
    Prod {
        /// Include and manage dependencies (ClickHouse, Redpanda, etc.) using Docker containers
        #[arg(long)]
        start_include_dependencies: bool,
    },
    /// Generate Dockerfiles, tokens, and migrations
    #[command(visible_alias = "g")]
    Generate(GenerateArgs),
    /// Clear temporary data and stop development infrastructure
    #[command(visible_alias = "cl")]
    Clean {},
    /// View Moose logs
    #[command(visible_alias = "l")]
    Logs {
        /// Follow the logs in real-time
        #[arg(short, long)]
        tail: bool,

        /// Filter logs by a specific string
        #[arg(short, long)]
        filter: Option<String>,
    },
    /// View Moose processes
    Ps {},
    /// List the project's Moose resources with queryable names and hittable URLs.
    ///
    /// Renders a table per resource type:
    ///   - tables: database-qualified name + schema fields (pastable into `moose query`)
    ///   - streams: topic id, schema fields, destination table
    ///   - ingestion_apis: name, HTTP method, full URL, destination topic
    ///   - consumption_apis: name, HTTP method, full URL, query params
    ///   - sql_resources, dictionaries, workflows, stream_transformations, web_apps
    ///
    /// URLs are built from the dev server's host/port in `moose.config.toml`;
    /// table names are the SQL-queryable form (database.name or bare name).
    Ls {
        /// Filter by infrastructure type
        /// (one of: tables, streams, ingestion, consumption, sql_resource,
        /// stream_transformations, workflows, web_apps, dictionaries). Omit
        /// to list every type.
        #[arg(long)]
        _type: Option<String>,

        /// Filter by name (supports partial matching)
        #[arg(long)]
        name: Option<String>,

        /// Output results in JSON format
        #[arg(long, default_value = "false")]
        json: bool,
    },

    /// Open the live metrics console
    #[command(visible_alias = "m")]
    Metrics {},
    /// Manage workflows
    #[command(visible_alias = "w")]
    Workflow(WorkflowArgs),
    /// Manage templates
    #[command(visible_alias = "t")]
    Template(TemplateCommands),
    /// Initialize a project with developer harness
    Harness(HarnessCommands),
    #[command(
        about = "[EXPERIMENTAL] Manage components",
        long_about = "Manage components\n\n[EXPERIMENTAL] Component APIs and available components may change in future releases."
    )]
    Component(ComponentCommands),
    /// Import external database schemas
    Db(DbArgs),
    /// Integrate tables from a remote Moose instance
    #[command(visible_alias = "r")]
    Refresh {
        /// URL of the remote Moose instance (default: http://localhost:4000)
        #[arg(long)]
        url: Option<String>,

        /// API token for the remote Moose instance
        #[arg(long)]
        token: Option<String>,
        // #[arg(default_value = "true", short, long)]
        // interactive: bool,
    },
    /// Seed data into your project
    #[command(visible_alias = "s")]
    Seed(SeedCommands),
    /// Truncate tables or delete the last N rows
    #[command(visible_alias = "tr")]
    Truncate {
        /// List of table names to target (omit when using --all)
        #[arg(value_name = "TABLE", num_args = 0.., value_delimiter = ',')]
        tables: Vec<String>,

        /// Apply to all non-view tables in the current database
        #[arg(long, conflicts_with = "tables", default_value = "false")]
        all: bool,

        /// Number of most recent rows to delete per table. Omit to delete all rows.
        #[arg(long)]
        rows: Option<u64>,
    },
    /// Run MCP proxy server for AI agents
    Mcp {
        /// Host of the dev server to proxy to (auto-detected from project config if omitted)
        #[arg(long)]
        host: Option<String>,

        /// Port of the dev server to proxy to (auto-detected from project config if omitted)
        #[arg(long)]
        port: Option<u16>,
    },
    /// Manage Kafka-related operations
    #[command(visible_alias = "k")]
    Kafka(KafkaArgs),
    /// Submit feedback or report issues
    #[command(visible_alias = "f")]
    Feedback {
        /// Feedback message (e.g. moose feedback "loving the DX!" or moose feedback --bug "crash on startup")
        #[arg(conflicts_with = "community")]
        message: Option<String>,

        /// Report a bug (opens GitHub Issues with system info and log paths)
        #[arg(long, conflicts_with = "community")]
        bug: bool,

        /// Join the Moose community on Slack
        #[arg(long, conflicts_with_all = ["bug", "message"])]
        community: bool,

        /// Your email address for follow-up (optional)
        #[arg(long, conflicts_with_all = ["bug", "community"], requires = "message")]
        email: Option<String>,
    },
    /// Execute SQL queries against ClickHouse
    #[command(visible_alias = "q")]
    Query {
        /// SQL query to execute
        query: Option<String>,

        /// Read query from file
        #[arg(short = 'f', long = "file", conflicts_with = "query")]
        file: Option<PathBuf>,

        /// Maximum number of rows to return (applied via ClickHouse settings)
        #[arg(short, long, default_value = "10000")]
        limit: u64,

        /// Format query as code literal (python|typescript). Skips execution.
        #[arg(short = 'c', long = "format-query", value_name = "LANGUAGE")]
        format_query: Option<String>,

        /// Prettify SQL before formatting
        #[arg(short = 'p', long = "prettify", requires = "format_query")]
        prettify: bool,
    },
    /// Browse and search documentation
    #[command(visible_alias = "do")]
    Docs(DocsArgs),
    #[command(
        visible_alias = "a",
        about = "[EXPERIMENTAL] Add a component to your project",
        long_about = "Add a component to your project\n\n[EXPERIMENTAL] Component APIs and available components may change in future releases.",
        after_help = "Examples:\n  moose add mcp-server --dir packages/moosestack-service\n  moose add chat --dir packages/web-app\n  moose add benchmark --dir moose"
    )]
    Add {
        #[command(subcommand)]
        component: AddComponent,
    },
}

#[derive(Debug, Clone, clap::Subcommand)]
pub enum AddComponent {
    /// MCP server with ClickHouse query tools at /tools
    #[command(
        name = "mcp-server",
        after_help = "Requirements:\n  - Must be run from (or pointed at with --dir) a Moose project\n\nExample:\n  moose add mcp-server --dir packages/moosestack-service"
    )]
    McpServer(AddArgs),
    /// AI chat panel for Next.js. Requires an MCP server (moose add mcp-server)
    #[command(
        after_help = "Requirements:\n  - Must be run from (or pointed at with --dir) a Next.js project\n  - Project must use App Router\n  - shadcn/ui must be initialized (components.json must exist)\n  - An MCP server must be set up first: moose add mcp-server --help\n\nExample:\n  moose add chat --dir packages/web-app"
    )]
    Chat(AddArgs),
    /// Query benchmark package for a TypeScript Moose project
    #[command(
        after_help = "Requirements:\n  - Must be run from (or pointed at with --dir) a TypeScript Moose project\n\nExample:\n  moose add benchmark --dir moose"
    )]
    Benchmark(AddArgs),
}

#[derive(Debug, Clone, Args)]
pub struct AddArgs {
    /// Target directory
    #[arg(long, short = 'd')]
    pub dir: Option<String>,
    /// Overwrite existing files
    #[arg(long)]
    pub overwrite: bool,
    /// Skip confirmation prompts
    #[arg(long, short = 'y')]
    pub yes: bool,
}

#[derive(Debug, Args)]
pub struct GenerateArgs {
    #[command(subcommand)]
    pub command: Option<GenerateCommand>,
}

#[derive(Debug, Subcommand)]
pub enum GenerateCommand {
    /// Generate the Dockerfile without building the Docker image
    #[command(visible_alias = "d")]
    Dockerfile {},
    /// Generate an API key hash and bearer token pair for authentication
    #[command(visible_alias = "h")]
    HashToken {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Generate migration files
    #[command(visible_alias = "m")]
    Migration {
        /// URL of the remote Moose instance (use with --token)
        #[arg(long, conflicts_with = "clickhouse_url")]
        url: Option<String>,

        /// API token for the remote Moose instance
        #[arg(long)]
        token: Option<String>,

        /// ClickHouse connection URL for serverless deployments
        #[arg(long, conflicts_with = "url")]
        clickhouse_url: Option<String>,

        /// Redis connection URL for state storage
        #[arg(long)]
        redis_url: Option<String>,

        /// Save migration files to the migrations/ directory
        #[arg(long, default_value = "false")]
        save: bool,

        /// Skip all confirmation prompts
        #[arg(long)]
        yes_all: bool,

        /// Auto-approve destructive operations
        #[arg(long)]
        yes_destructive: bool,

        /// Auto-approve column renames
        #[arg(long)]
        yes_rename: bool,

        /// Disable automatic backfill SQL generation
        #[arg(long)]
        no_auto_backfill_sql: bool,

        /// Agent-driven mode: confirmation prompts are answered via the MCP
        /// `respond_to_prompt` tool instead of stdin.
        #[arg(long)]
        agent: bool,
    },
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct WorkflowArgs {
    #[command(subcommand)]
    pub command: Option<WorkflowCommands>,
}

#[derive(Debug, Subcommand)]
pub enum WorkflowCommands {
    /// Run a workflow
    #[command(visible_alias = "r")]
    Run {
        /// Name of the workflow to run
        name: String,

        /// JSON input parameters for the workflow
        #[arg(short, long)]
        input: Option<String>,
    },
    /// Resume a workflow from a specific task
    #[command(visible_alias = "rs")]
    Resume {
        /// Name of the workflow to resume
        name: String,

        /// Task to resume from
        #[arg(long)]
        from: String,
    },
    /// List registered workflows
    #[command(visible_alias = "l")]
    List {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Show workflow history
    #[command(visible_alias = "h")]
    History {
        /// Filter workflows by status (running, completed, failed)
        #[arg(short, long)]
        status: Option<String>,

        /// Limit the number of workflows shown
        #[arg(short, long, default_value = "10")]
        limit: u32,

        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Terminate a workflow
    #[command(hide = true)]
    Terminate {
        /// Name of the workflow to terminate
        name: String,
    },
    /// Cancel a workflow & allow tasks to execute cleanup
    #[command(visible_alias = "c")]
    Cancel {
        /// Name of the workflow to cancel
        name: String,
    },
    /// Pause a workflow
    #[command(visible_alias = "p")]
    Pause {
        /// Name of the workflow to pause
        name: String,
    },
    /// Unpause a workflow
    #[command(visible_alias = "u")]
    Unpause {
        /// Name of the workflow to unpause
        name: String,
    },
    /// Get the status of a workflow
    #[command(visible_alias = "s")]
    Status {
        /// Name of the workflow
        name: String,

        /// Optional run ID (defaults to most recent)
        #[arg(long)]
        id: Option<String>,

        /// Verbose output
        #[arg(long)]
        verbose: bool,

        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct TemplateCommands {
    #[command(subcommand)]
    pub command: Option<TemplateSubCommands>,
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct HarnessCommands {
    #[command(subcommand)]
    pub command: HarnessSubCommands,
}

#[derive(Debug, Subcommand)]
pub enum HarnessSubCommands {
    /// Initialize a Moose project plus the developer harness
    #[command(visible_alias = "i")]
    Init(HarnessInitArgs),
}

#[derive(Debug, Subcommand)]
pub enum HarnessInitAction {
    /// Show the machine-readable input contract for `moose harness init`
    Schema {
        /// Output schema in JSON format
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Args)]
#[command(after_help = "Examples:
  moose harness init
  moose harness init my-app typescript --agent codex
  moose harness init --name schema --template typescript --agent none
  moose harness init my-app python-empty --location ./sandbox
  moose harness init --input request.json
  cat request.json | moose harness init --input -
  moose harness init schema --json

Arg-driven mode is non-interactive. When any flags, positionals, or --input are provided,
omitted optional values resolve to defaults and the command does not prompt.")]
pub struct HarnessInitArgs {
    #[command(subcommand)]
    pub action: Option<HarnessInitAction>,

    /// Explicit project name. Use this when the name would otherwise conflict with a subcommand like `schema`
    #[arg(long = "name", value_name = "NAME", conflicts_with = "name")]
    pub name_option: Option<String>,

    /// Explicit template name. Use this with `--name` when positional parsing would be ambiguous
    #[arg(
        long = "template",
        value_name = "TEMPLATE",
        conflicts_with = "template"
    )]
    pub template_option: Option<String>,

    /// Name of your app or service
    pub name: Option<String>,

    /// Template to use for the project
    pub template: Option<String>,

    /// Location of your app or service
    #[arg(short, long)]
    pub location: Option<String>,

    /// Allow init in an existing directory
    #[arg(long)]
    pub no_fail_already_exists: bool,

    /// Initialize from a remote ClickHouse database
    #[arg(long, value_name = "CONNECTION_STRING")]
    pub from_remote: Option<String>,

    /// Generate a custom Dockerfile at project root
    #[arg(long)]
    pub custom_dockerfile: bool,

    /// Target specific coding agents instead of auto-detecting
    #[arg(long = "agent")]
    pub agents: Vec<String>,

    /// Install and configure MooseStack LSP
    #[arg(long, conflicts_with = "no_lsp")]
    pub lsp: bool,

    /// Skip MooseStack LSP installation/configuration
    #[arg(long, conflicts_with = "lsp")]
    pub no_lsp: bool,

    /// Git branch of the agent-skills repo to install from (default: main)
    #[arg(long)]
    pub branch: Option<String>,

    /// Read structured JSON input from a file, or use `-` to read from stdin
    #[arg(long)]
    pub input: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum TemplateSubCommands {
    /// List available templates
    #[command(visible_alias = "l")]
    List {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct ComponentCommands {
    #[command(subcommand)]
    pub command: Option<ComponentSubCommands>,
}

#[derive(Debug, Subcommand)]
pub enum ComponentSubCommands {
    /// List available components
    #[command(visible_alias = "l")]
    List {},
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct SeedCommands {
    #[command(subcommand)]
    pub command: Option<SeedSubcommands>,
}

#[derive(Debug, Subcommand)]
pub enum SeedSubcommands {
    /// Seed ClickHouse tables with data
    #[command(visible_alias = "c")]
    Clickhouse {
        /// ClickHouse connection URL (e.g. 'clickhouse://explorer@play.clickhouse.com:9440/default')
        #[arg(long, alias = "connection-string")]
        clickhouse_url: Option<String>,
        /// Maximum rows to copy per table
        #[arg(long, value_name = "LIMIT", conflicts_with = "all")]
        limit: Option<usize>,
        /// Copy all rows, ignoring limit
        #[arg(long, default_value = "false", conflicts_with = "limit")]
        all: bool,
        /// ORDER BY clause for the seed query
        #[arg(long)]
        order_by: Option<String>,
        /// Only seed a specific table
        #[arg(long, value_name = "TABLE_NAME")]
        table: Option<String>,
        /// Show row counts after seeding
        #[arg(long, default_value = "true", action = clap::ArgAction::Set)]
        report: bool,
    },
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct DbArgs {
    #[command(subcommand)]
    pub command: DbCommands,
}

#[derive(Debug, Subcommand)]
pub enum DbCommands {
    /// Update DB schema for EXTERNALLY_MANAGED tables
    #[command(visible_alias = "p")]
    Pull {
        /// ClickHouse connection URL (e.g., clickhouse://user:pass@host:port/database or https://user:pass@host:port/database)
        #[arg(long)]
        clickhouse_url: Option<String>,
        /// Output file for external table definitions
        #[arg(long)]
        file_path: Option<String>,
    },
}

#[derive(Debug, Args)]
#[command(arg_required_else_help = true)]
pub struct KafkaArgs {
    #[command(subcommand)]
    pub command: KafkaCommands,
}

/// Arguments for the docs command
#[derive(Debug, Args)]
#[command(after_help = "\
Examples:
  moose docs                              Show documentation index (collapsed)
  moose docs --expand                     Show full index with all pages and guide sections
  moose docs moosestack/olap              View the OLAP documentation page
  moose docs search \"materialized\"        Search for pages matching a query
  moose docs search --expand \"setup\"      Also search within page headings (slower)
  moose docs --lang py moosestack/olap    View page in Python (default: auto-detected)
  moose docs browse                       Interactively browse and select a page
  moose docs browse --web                 Browse and open selection in your browser
  moose docs moosestack/olap --web        Open a page directly in the browser

Guide sections (guides are large — navigate to specific sections):
  moose docs guides/chat-in-your-app#overview       View just the Overview section
  moose docs guides/chat-in-your-app#setup          View just the Setup section
  moose docs guides/performant-dashboards --web     Open full guide in the browser

Example: use with your AI client
  moose docs --raw guides/chat-in-your-app#setup | claude \"do this step, ask me any questions you need to execute\"

Slugs are case-insensitive. Run `moose docs` to see all available slugs.")]
pub struct DocsArgs {
    #[command(subcommand)]
    pub command: Option<DocsCommands>,

    /// Documentation page slug (e.g., moosestack/olap, guides/chat-in-your-app#overview)
    pub slug: Option<String>,

    /// Language for documentation: typescript (ts) or python (py)
    #[arg(long, short = 'l', global = true)]
    pub lang: Option<String>,

    /// Output raw content without formatting (for piping to other tools)
    #[arg(long, global = true)]
    pub raw: bool,

    /// Show full expanded tree with all leaf pages
    #[arg(long)]
    pub expand: bool,

    /// Open documentation page in your web browser instead of printing
    #[arg(long, global = true)]
    pub web: bool,
}

/// Subcommands for the docs command
#[derive(Debug, Subcommand)]
pub enum DocsCommands {
    /// Interactively browse and select a documentation page
    #[command(visible_alias = "b")]
    Browse {},
    /// Search documentation by title or description
    #[command(visible_alias = "s")]
    Search {
        /// Search query to filter documentation entries
        query: String,
        /// Also search within page headings (H1/H2/H3) — slower, fetches all pages
        #[arg(long)]
        expand: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum KafkaCommands {
    /// Discover topics and generate external stream declarations;
    /// optionally fetch JSON Schemas (Avro support coming soon)
    /// from Schema Registry to emit typed models.
    #[command(visible_alias = "p")]
    Pull {
        /// Kafka bootstrap servers, e.g. localhost:9092
        bootstrap: String,

        /// Output path for schemas
        #[arg(long, value_name = "PATH")]
        path: Option<String>,

        /// Include pattern (glob)
        #[arg(long, default_value = "*")]
        include: String,

        /// Exclude pattern (glob)
        #[arg(long, default_value = "{__consumer_offsets,_schemas}")]
        exclude: String,

        /// Schema Registry base URL (e.g. http://localhost:8081)
        #[arg(long, value_name = "URL")]
        schema_registry: Option<String>,
    },
}
