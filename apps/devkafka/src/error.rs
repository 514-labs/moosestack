use kafka_protocol::protocol::StrBytes;
use thiserror::Error;

// Kafka protocol error codes.
pub const NONE: i16 = 0;
pub const UNKNOWN_SERVER_ERROR: i16 = -1;
pub const UNKNOWN_TOPIC_OR_PARTITION: i16 = 3;
pub const NOT_COORDINATOR: i16 = 16;
pub const ILLEGAL_GENERATION: i16 = 22;
pub const INCONSISTENT_GROUP_PROTOCOL: i16 = 23;
pub const INVALID_GROUP_ID: i16 = 24;
pub const UNKNOWN_MEMBER_ID: i16 = 25;
pub const REBALANCE_IN_PROGRESS: i16 = 27;
pub const UNSUPPORTED_VERSION: i16 = 35;
pub const TOPIC_ALREADY_EXISTS: i16 = 36;
pub const INVALID_REPLICATION_FACTOR: i16 = 38;
pub const GROUP_ID_NOT_FOUND: i16 = 69;
pub const INVALID_RECORD: i16 = 87;

/// Errors that can occur during Kafka broker request handling.
#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum BrokerError {
    #[error("unknown topic: {0}")]
    UnknownTopic(StrBytes),

    #[error("unknown partition: {topic}[{partition}]")]
    UnknownPartition { topic: StrBytes, partition: i32 },

    #[error("invalid record batch")]
    InvalidRecordBatch,

    #[error("unsupported API key: key={api_key} version={version}")]
    UnsupportedApiKey { api_key: i16, version: i16 },

    #[error("unknown member: {0}")]
    UnknownMember(StrBytes),

    #[error("illegal generation: {0}")]
    IllegalGeneration(i32),

    #[error("rebalance in progress")]
    RebalanceInProgress,

    #[error("not coordinator")]
    NotCoordinator,

    #[error("group id required")]
    InvalidGroupId,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("protocol decode error: {0}")]
    Decode(Box<dyn std::error::Error + Send + Sync>),
}

/// Errors for the connection layer (framing, decoding, IO).
#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("frame size {size} exceeds maximum {max}")]
    FrameTooLarge { size: usize, max: usize },

    #[error("connection closed mid-frame")]
    ClosedMidFrame,

    #[error("frame too small ({0} bytes)")]
    FrameTooSmall(usize),

    #[error("handler error: {0}")]
    Handler(#[from] BrokerError),

    #[error("protocol decode error: {0}")]
    Decode(Box<dyn std::error::Error + Send + Sync>),
}

impl BrokerError {
    /// Map to the corresponding Kafka protocol error code.
    pub fn kafka_error_code(&self) -> i16 {
        match self {
            BrokerError::UnknownTopic(_) => UNKNOWN_TOPIC_OR_PARTITION,
            BrokerError::UnknownPartition { .. } => UNKNOWN_TOPIC_OR_PARTITION,
            BrokerError::InvalidRecordBatch => INVALID_RECORD,
            BrokerError::UnsupportedApiKey { .. } => UNSUPPORTED_VERSION,
            BrokerError::UnknownMember(_) => UNKNOWN_MEMBER_ID,
            BrokerError::IllegalGeneration(_) => ILLEGAL_GENERATION,
            BrokerError::RebalanceInProgress => REBALANCE_IN_PROGRESS,
            BrokerError::NotCoordinator => NOT_COORDINATOR,
            BrokerError::InvalidGroupId => INVALID_GROUP_ID,
            BrokerError::Io(_) => UNKNOWN_SERVER_ERROR,
            BrokerError::Decode(_) => UNKNOWN_SERVER_ERROR,
        }
    }
}
