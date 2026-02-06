//! Help command display module
//!
//! Provides a styled help output following Graphite CLI best practices.

use crate::utilities::constants::CLI_VERSION;

/// Documentation and community URLs
const DOCS_URL: &str = "https://docs.moosejs.com";
const QUICKSTART_URL: &str = "https://docs.moosejs.com/moosestack/getting-started/quickstart";
const TROUBLESHOOTING_URL: &str = "https://docs.moosejs.com/moosestack/help/troubleshooting";
const GITHUB_ISSUES_URL: &str = "https://github.com/514-labs/moose/issues";
const SLACK_COMMUNITY_URL: &str =
    "https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg";

/// Display the styled help output
pub fn display_help() {
    let help_text = format!(
        r#"
Moose (moose) is a type-safe, code-first toolkit for building real-time
analytical backends. Declare all infrastructure and pipelines in TypeScript
or Python, and Moose auto-wires everything together.

USAGE
  $ moose <command> [options]

TERMS
  data model:  A typed schema definition that represents your data structure.
               Used to create tables, streams, and APIs automatically.
  stream:      A Kafka/Redpanda topic for real-time data ingestion and
               processing. Connects ingest APIs to tables.
  table:       A ClickHouse OLAP table for storing and querying data.
               Automatically created from your data models.
  workflow:    A Temporal-powered background task for ETL pipelines,
               scheduled jobs, and complex data processing.
  api:         HTTP endpoints for data ingestion (POST) and analytics (GET).
               Auto-generated with type validation.

CORE COMMANDS
  moose init:           Create a new Moose project with your preferred language
  moose dev:            Start local development server with hot reload
  moose build:          Build your project for production deployment
  moose plan:           Preview infrastructure changes before deployment
  moose migrate:        Execute migration plan against production database

  Run moose <command> --help for specific command help
  (e.g., moose init --help)

CORE WORKFLOW
  1. Initialize your project:
     $ moose init my-app typescript   # or python

  2. Start development server:
     $ cd my-app && moose dev

  3. Define data models in code - infrastructure auto-updates on save

  4. Build and deploy to production:
     $ moose build
     $ moose plan --clickhouse-url <url>
     $ moose migrate --clickhouse-url <url>

LEARN MORE
  Documentation:     {docs}
  Quickstart Guide:  {quickstart}
  Troubleshooting:   {troubleshooting}

FEEDBACK
  We'd love to hear your feedback! Join our Slack community at:
      {slack}

  Report issues or request features on GitHub:
      {github}

  Include your Moose version ({version}) when reporting issues.
"#,
        docs = DOCS_URL,
        quickstart = QUICKSTART_URL,
        troubleshooting = TROUBLESHOOTING_URL,
        slack = SLACK_COMMUNITY_URL,
        github = GITHUB_ISSUES_URL,
        version = CLI_VERSION,
    );

    println!("{}", help_text);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_help_runs_without_panic() {
        // This test just ensures the function doesn't panic
        display_help();
    }
}
