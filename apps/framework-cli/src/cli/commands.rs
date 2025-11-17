//! # CLI Commands
//! A module for all the commands that can be run from the CLI

use std::path::PathBuf;

use clap::{Args, Subcommand};

#[derive(Subcommand)]
pub enum Commands {
    // Initializes the developer environment with all the necessary directories including temporary ones for data storage
    /// Initialize your data-intensive app or service
    Init {
        /// Name of your app or service
        name: String,

        /// Template to use for the project
        #[arg(
            conflicts_with = "from_remote",
            required_unless_present = "from_remote"
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
            required_unless_present = "template",
            value_name = "CONNECTION_STRING",
            num_args = 0..=1
        )]
        from_remote: Option<Option<String>>,

        /// Programming language to use for the project
        #[arg(long, conflicts_with = "template")]
        language: Option<String>,
    },
    /// Builds your moose project
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
    Check {
        #[arg(long, default_value = "false")]
        write_infra_map: bool,
    },
    /// Displays the changes that will be applied to the infrastructure during the next deployment
    /// to production, considering the current state of the project
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
    },

    /// Execute a migration plan against a remote ClickHouse database
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
    Dev {
        /// Skip starting docker containers for infrastructure
        #[arg(long)]
        no_infra: bool,

        /// Enable or disable the MCP (Model Context Protocol) server
        #[arg(long, default_value = "true")]
        mcp: bool,
    },
    /// Start a remote environment for use in cloud deployments
    Prod {
        /// Include and manage dependencies (ClickHouse, Redpanda, etc.) using Docker containers
        #[arg(long)]
        start_include_dependencies: bool,
    },
    /// Generates helpers for your data models (i.e. sdk, api tokens)
    Generate(GenerateArgs),
    /// Clears all temporary data and stops development infrastructure
    Clean {},
    /// View Moose logs
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
        /// Filter by infrastructure type (tables, streams, ingestion, sql_resource, consumption)
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
    Metrics {},
    /// Manage data processing workflows
    Workflow(WorkflowArgs),
    /// Manage templates
    Template(TemplateCommands),
    /// Manage database schema import
    Db(DbArgs),
    /// Integrate matching tables from a remote Moose instance into the local project
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
    Seed(SeedCommands),
    /// Truncate tables or delete the last N rows
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
    Kafka(KafkaArgs),
    /// Execute SQL queries against ClickHouse
    Query {
        /// SQL query to execute
        query: Option<String>,

        /// Read query from file
        #[arg(short = 'f', long = "file", conflicts_with = "query")]
        file: Option<PathBuf>,

        /// Maximum number of rows to return (applied via ClickHouse settings)
        #[arg(short, long, default_value = "10000")]
        limit: u64,
    },
}

#[derive(Debug, Args)]
pub struct GenerateArgs {
    #[command(subcommand)]
    pub command: Option<GenerateCommand>,
}

#[derive(Debug, Subcommand)]
pub enum GenerateCommand {
    HashToken {},
    /// Generate migration files
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
    Run {
        /// Name of the workflow to run
        name: String,

        /// JSON input parameters for the workflow
        #[arg(short, long)]
        input: Option<String>,
    },
    /// Resume a workflow from a specific task
    Resume {
        /// Name of the workflow to resume
        name: String,

        /// Task to resume from
        #[arg(long)]
        from: String,
    },
    /// List registered workflows
    List {
        /// Output in JSON format
        #[arg(long)]
        json: bool,
    },
    /// Show workflow history
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
    Cancel {
        /// Name of the workflow to cancel
        name: String,
    },
    /// Pause a workflow
    Pause {
        /// Name of the workflow to pause
        name: String,
    },
    /// Unpause a workflow
    Unpause {
        /// Name of the workflow to unpause
        name: String,
    },
    /// Get the status of a workflow
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
    Clickhouse {
        /// ClickHouse connection string (e.g. 'clickhouse://explorer@play.clickhouse.com:9440/default')
        #[arg(long, value_name = "CONNECTION_STRING")]
        connection_string: Option<String>,
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
    Pull {
        /// ClickHouse connection string (e.g. 'E.g. https://play.clickhouse.com/?user=explorer')
        #[arg(long, value_name = "CONNECTION_STRING")]
        connection_string: Option<String>,
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

#[derive(Debug, Subcommand)]
pub enum KafkaCommands {
    /// Discover topics and generate external stream declarations;
    /// optionally fetch JSON Schemas (Avro support coming soon)
    /// from Schema Registry to emit typed models.
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
