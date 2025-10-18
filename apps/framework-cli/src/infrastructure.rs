//! # Infrastructure
//! This module contains all the functionality for configuring local and cloud infrastructure
//!
//! ## Local Infrastructure
//!
//! ### Redpanda
//! Redpanda is a Kafka API compatible streaming platform that is used for queuing up data.
//!
//! ### Clickhouse
//! Clickhouse is a columnar database that is used for storing data and querying data
//!
//! ### Ingest
//! The ingest module contains all the functionality for ingesting data into the local or cloud
//! infrastructure.
//!

pub mod api;
pub mod olap;
pub mod orchestration;
pub mod processes;
pub mod redis;
pub mod stream;
pub mod webapp;
