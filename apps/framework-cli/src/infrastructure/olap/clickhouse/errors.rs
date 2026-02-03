#[derive(Debug, thiserror::Error)]
#[error("failed interact with clickhouse")]
#[non_exhaustive]
pub enum ClickhouseError {
    #[error("Clickhouse - Unsupported data type: {type_name}")]
    UnsupportedDataType {
        type_name: String,
    },
    #[error("Clickhouse - Invalid parameters: {message}")]
    InvalidParameters {
        message: String,
    },
    #[error("Clickhouse - Invalid {identifier_type}: '{name}' - {reason}")]
    InvalidIdentifier {
        identifier_type: String,
        name: String,
        reason: String,
    },
    QueryRender(#[from] handlebars::RenderError),
}
