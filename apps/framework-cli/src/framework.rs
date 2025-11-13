use clap::Subcommand;

pub mod blocks;
pub mod bulk_import;
pub mod core;
pub mod data_model;
pub mod languages;
pub mod python;
pub mod scripts;
pub mod sdk;
pub mod streaming;
pub mod typescript;
pub mod versions;

pub enum Insights {
    Metric,
    Dashboard,
    Model,
}

pub enum TopLevelObjects {
    Ingestion,
    StreamingFunction,
    DataModel,
    Insights(Insights),
}

#[derive(Debug, Subcommand)]
pub enum AddableObjects {
    IngestPoint,
    StreamingFunction,
    DataModel,
    Metric,
    Dashboard,
    Model,
}
