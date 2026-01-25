//! # CLI Commands
//! A module for all the commands that can be run from the CLI

use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum Commands {
    // Initializes the developer environment with all the necessary directories including temporary ones for data storage
    /// Initialize your data-intensive app or service
    #[command(visible_alias = "i")]
    Init {
        /// Name of your app or service
        name: String,

        /// Template to use for the project
        #[arg(
            conflicts_with = "from_remote",
            required_unless_present_any = ["from_remote", "language"]
        )]
        template: Option<String>,

        /// Location of your app or service
        #[arg(short, long)]
        location: Option<String>,

        /// By default, the init command fails if the location directory exists, to prevent accidental reruns. This flag disables the check.
        #[arg(long)]
        no_fail_already_exists: bool,

        /// Initialize from a remote database. E.g. https://play.clickhouse.com/?user=explorer
        #[arg(
            long,
            required_unless_present_any = ["template", "language"],
            value_name = "CONNECTION_STRING",
            num_args = 0..=1
        )]
        from_remote: Option<Option<String>>,

        /// Programming language to use for the project
        #[arg(long, conflicts_with = "template")]
        language: Option<String>,

        /// Generate a custom Dockerfile at project root for customization
        #[arg(long)]
        custom_dockerfile: bool,
    },
    /// Builds your moose project
    #[command(visible_alias = "b")]
    Build {
        /// Build for docker
        #[arg(short, long, default_value = "false")]
        docker: bool,
        /// Build for amd64 architecture
        #[arg(long)]
        amd64: bool,
        /// Build for arm64 architecture
        #[arg(long)]
        arm64: bool,
    },
    /// Checks the project for non-runtime errors
    #[command(visible_alias = "c")]
    Check {
        #[arg(long, default_value = "false")]
        write_infra_map: bool,
    },
    /// Displays the changes that will be applied to the infrastructure during the next deployment
    /// to production, considering the current state of the project
    #[command(visible_alias = "pl")]
    Plan {
        /// URL of the remote Moose instance (default: http://localhost:4000)
        #[arg(long, conflicts_with = "clickhouse_url")]
        url: Option<String>,

        /// API token for authentication with the remote Moose instance
        /// This token will be sent as a Bearer token in the Authorization header
        #[arg(long)]
        token: Option<String>,

        /// ClickHouse connection URL for serverless deployments
        #[arg(long, conflicts_with = "url")]
        clickhouse_url: Option<String>,

        /// Output plan as JSON for programmatic use
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

        /// Redis connection URL for state storage (e.g., redis://host:port)
        /// Required when state_config.storage = "redis"
        #[arg(long)]
        redis_url: Option<String>,
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
    /// Starts a local development environment to build your data-intensive app or service
    #[command(visible_alias = "d")]
    Dev {
        /// Skip starting docker containers for infrastructure
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

        /// Launch interactive Terminal User Interface for development mode
        #[arg(long)]
        tui: bool,
    },
    /// Start a remote environment for use in cloud deployments
    #[command(visible_alias = "p")]
    Prod {
        /// Include and manage dependencies (ClickHouse, Redpanda, etc.) using Docker containers
        #[arg(long)]
        start_include_dependencies: bool,
    },
    /// Generates helpers for your data models (i.e. sdk, api tokens)
    #[command(visible_alias = "g")]
    Generate(GenerateArgs),
    /// Clears all temporary data and stops development infrastructure
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
    /// View Moose primitives & infrastructure
    Ls {
        /// Filter by infrastructure type (tables, streams, ingestion, sql_resource, consumption, workflows, web_apps)
        #[arg(long)]
        _type: Option<String>,

        /// Filter by name (supports partial matching)
        #[arg(long)]
        name: Option<String>,

        /// Output results in JSON format
        #[arg(long, default_value = "false")]
        json: bool,
    },

    /// Opens metrics console for viewing live metrics from your moose app
    #[command(visible_alias = "m")]
    Metrics {},
    /// Manage data processing workflows
    #[command(visible_alias = "w")]
    Workflow(WorkflowArgs),
    /// Manage templates
    #[command(visible_alias = "t")]
    Template(TemplateCommands),
    /// Manage database schema import
    Db(DbArgs),
    /// Integrate matching tables from a remote Moose instance into the local project
    #[command(visible_alias = "r")]
    Refresh {
        /// URL of the remote Moose instance (default: http://localhost:4000)
        #[arg(long)]
        url: Option<String>,

        /// API token for authentication with the remote Moose instance
        /// This token will be sent as a Bearer token in the Authorization header
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

        /// Apply the operation to all tables in the current database
        #[arg(long, conflicts_with = "tables", default_value = "false")]
        all: bool,

        /// Number of most recent rows to delete per table. Omit to delete all rows.
        #[arg(long)]
        rows: Option<u64>,
    },
    /// Manage Kafka-related operations
    #[command(visible_alias = "k")]
    Kafka(KafkaArgs),
    /// Submit feedback, report issues, or join the community
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

        /// Prettify SQL before formatting (only with --format-query)
        #[arg(short = 'p', long = "prettify", requires = "format_query")]
        prettify: bool,
    },
    /// Fetch and display LLM-optimized documentation for AI agents
    #[command(visible_alias = "do")]
    Docs(DocsArgs),
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

        /// API token for authentication with the remote Moose instance
        /// This token will be sent as a Bearer token in the Authorization header
        #[arg(long)]
        token: Option<String>,

        /// ClickHouse connection URL for serverless deployments
        #[arg(long, conflicts_with = "url")]
        clickhouse_url: Option<String>,

        /// Redis connection URL for state storage (e.g., redis://host:port)
        /// Required when state_config.storage = "redis"
        #[arg(long)]
        redis_url: Option<String>,

        /// Save the migration files in the migrations/ directory
        #[arg(long, default_value = "false")]
        save: bool,
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

#[derive(Debug, Subcommand)]
pub enum TemplateSubCommands {
    /// List available templates
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
        /// Limit the number of rows to copy per table (default: 1000)
        #[arg(
            long,
            value_name = "LIMIT",
            default_value_t = 1000,
            conflicts_with = "all"
        )]
        limit: usize,
        /// Copy all rows (ignore limit). If set for a table, copies entire table.
        #[arg(long, default_value = "false", conflicts_with = "limit")]
        all: bool,
        /// ORDER BY clause of the query. e.g. `--order-by 'timestamp DESC' --limit 10` for the latest 10 rows
        #[arg(long)]
        order_by: Option<String>,
        /// Only seed a specific table (optional)
        #[arg(long, value_name = "TABLE_NAME")]
        table: Option<String>,
        /// Report row counts after seeding. Counts shown for default database only (use --report=false to skip)
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
        /// File storing the EXTERNALLY_MANAGED table definitions, defaults to app/external_models.py or app/externalModels.ts
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
  moose docs --lang py moosestack/olap    View page in Python (default: auto-detected)
  moose docs browse                       Interactively browse and select a page
  moose docs browse --web                 Browse and open selection in your browser
  moose docs moosestack/olap --web        Open a page directly in the browser

Guide sections (guides are large — navigate to specific sections):
  moose docs guides/chat-in-your-app#overview       View just the Overview section
  moose docs guides/chat-in-your-app#setup          View just the Setup section
  moose docs guides/performant-dashboards --web     Open full guide in the browser

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

        /// Include pattern (glob). Defaults to '*'
        #[arg(long, default_value = "*")]
        include: String,

        /// Exclude pattern (glob). Defaults to '{__consumer_offsets,_schemas}'
        #[arg(long, default_value = "{__consumer_offsets,_schemas}")]
        exclude: String,

        /// Schema Registry base URL (e.g. http://localhost:8081)
        #[arg(long, value_name = "URL")]
        schema_registry: Option<String>,
    },
}
