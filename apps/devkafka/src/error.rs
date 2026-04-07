use kafka_protocol::protocol::StrBytes;
use thiserror::Error;

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum BrokerError {
    #[error("unknown topic: {0}")]
    UnknownTopic(StrBytes),

    #[error("unknown partition: {topic}[{partition}]")]
    UnknownPartition { topic: StrBytes, partition: i32 },

    #[error("invalid record batch")]
    InvalidRecordBatch,

    #[error("unsupported API version: key={api_key} version={version}")]
    UnsupportedVersion { api_key: i16, version: i16 },

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
    Decode(#[from] anyhow::Error),
}

impl BrokerError {
    /// Map to Kafka error code (i16).
    pub fn kafka_error_code(&self) -> i16 {
        match self {
            BrokerError::UnknownTopic(_) => 3, // UNKNOWN_TOPIC_OR_PARTITION
            BrokerError::UnknownPartition { .. } => 3, // UNKNOWN_TOPIC_OR_PARTITION
            BrokerError::InvalidRecordBatch => 87, // INVALID_RECORD
            BrokerError::UnsupportedVersion { .. } => 35, // UNSUPPORTED_VERSION
            BrokerError::UnknownMember(_) => 25, // UNKNOWN_MEMBER_ID
            BrokerError::IllegalGeneration(_) => 22, // ILLEGAL_GENERATION
            BrokerError::RebalanceInProgress => 27, // REBALANCE_IN_PROGRESS
            BrokerError::NotCoordinator => 16, // NOT_COORDINATOR
            BrokerError::InvalidGroupId => 24, // INVALID_GROUP_ID
            BrokerError::Io(_) => -1,          // UNKNOWN_SERVER_ERROR
            BrokerError::Decode(_) => -1,      // UNKNOWN_SERVER_ERROR
        }
    }
}
