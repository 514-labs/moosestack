//! `devkafka` — a minimal, in-process Kafka-compatible broker for local development.
//!
//! It implements just enough of the Kafka protocol (produce, fetch, consumer groups,
//! offsets) to let Moose applications run without a full Kafka/Redpanda cluster.

pub mod broker;
pub mod connection;
pub mod error;
pub mod groups;
pub mod handlers;
pub mod server;
pub mod storage;
