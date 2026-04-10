use std::path::PathBuf;

use crate::infrastructure::processes::consumption_registry::ConsumptionError;
use crate::utilities::native_infra::errors::NativeInfraError;

/// Errors that can occur when running `moose function`.
#[derive(Debug, thiserror::Error)]
pub enum FunctionError {
    #[error("clickhouse-local: {0}")]
    ClickHouseLocal(#[from] ClickHouseLocalError),

    #[error("consumption API: {0}")]
    ConsumptionApi(#[from] ConsumptionError),

    #[error("infrastructure map: {0}")]
    InfraMap(String),

    #[error("HTTP server: {0}")]
    HttpServer(#[source] Box<dyn std::error::Error + Send + Sync>),

    #[error("TypeScript compilation failed: {0}")]
    TsCompilation(String),
}

/// Errors specific to the clickhouse-local lifecycle.
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum ClickHouseLocalError {
    #[error("failed to set up clickhouse binary")]
    BinarySetup(#[from] NativeInfraError),

    #[error("failed to write config to {path}")]
    WriteConfig {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to start clickhouse-local process")]
    ProcessStart(#[source] std::io::Error),

    #[error("health check timed out after {timeout_secs}s on port {port}")]
    HealthCheckTimeout { port: u16, timeout_secs: u64 },

    #[error("failed to create database `{db_name}`: {reason}")]
    CreateDatabase { db_name: String, reason: String },

    #[error("failed to create table `{table}`: {reason}")]
    CreateTable { table: String, reason: String },

    #[error("DDL generation failed for table `{table}`: {reason}")]
    DdlGeneration { table: String, reason: String },

    #[error(
        "table `{table}` uses engine `{engine}` which is not supported in serverless mode \
         (only S3 and IcebergS3 are supported)"
    )]
    UnsupportedEngine { table: String, engine: String },
}
