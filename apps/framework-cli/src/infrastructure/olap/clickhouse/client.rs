use base64::prelude::*;
use http_body_util::BodyExt;
use http_body_util::Full;

use async_recursion::async_recursion;
use hyper::body::Bytes;
use hyper::{Request, Response, Uri};
use hyper_tls::HttpsConnector;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use tokio::time::{sleep, Duration};
use tracing::debug;

use super::config::ClickHouseConfig;
use super::model::{wrap_and_join_column_names, ClickHouseRecord};

use tracing::error;

use async_trait::async_trait;

pub struct ClickHouseClient {
    client: Client<HttpConnector, Full<Bytes>>,
    ssl_client: Client<HttpsConnector<HttpConnector>, Full<Bytes>>,
    config: ClickHouseConfig,
}

// Considering Clickhouse could take 30s to wake up, we need to have a backoff strategy
const BACKOFF_START_MILLIS: u64 = 1000;
const MAX_RETRIES: u8 = 10;
// Retries will be 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s

// TODO - investigate if we need to change basic auth
impl ClickHouseClient {
    pub fn new(clickhouse_config: &ClickHouseConfig) -> anyhow::Result<Self> {
        let client_builder = Client::builder(hyper_util::rt::TokioExecutor::new());

        let https = HttpsConnector::new();
        let http = HttpConnector::new();

        Ok(Self {
            client: client_builder.build(http),
            ssl_client: client_builder.build(https),
            config: clickhouse_config.clone(),
        })
    }

    pub fn config(&self) -> &ClickHouseConfig {
        &self.config
    }

    #[async_recursion]
    async fn request(
        &self,
        req: Request<Full<Bytes>>,
        retries: u8,
        backoff_millis: u64,
    ) -> Result<Response<hyper::body::Incoming>, hyper_util::client::legacy::Error> {
        let res = if self.config.use_ssl {
            self.ssl_client.request(req.clone()).await
        } else {
            self.client.request(req.clone()).await
        };

        match res {
            Ok(res) => Ok(res),
            Err(e) => {
                if e.is_connect() {
                    if retries > 0 {
                        sleep(Duration::from_millis(backoff_millis)).await;
                        self.request(req, retries - 1, backoff_millis * 2).await
                    } else {
                        Err(e)
                    }
                } else {
                    Err(e)
                }
            }
        }
    }

    pub async fn ping(&mut self) -> anyhow::Result<()> {
        let empty_body = Bytes::new();

        let req = Request::builder()
            .method("GET")
            .uri("/ping")
            .body(Full::new(empty_body))?;

        let res: Response<hyper::body::Incoming> =
            self.request(req, MAX_RETRIES, BACKOFF_START_MILLIS).await?;

        assert_eq!(res.status(), 200);
        Ok(())
    }

    fn auth_header(&self) -> String {
        // TODO properly encode basic auth
        let username_and_password = format!("{}:{}", self.config.user, self.config.password);
        let encoded = BASE64_STANDARD.encode(username_and_password);
        format!("Basic {encoded}")
    }

    fn host(&self) -> String {
        format!("{}:{}", self.config.host, self.config.host_port)
    }

    fn uri(&self, path: String) -> anyhow::Result<Uri> {
        let scheme = if self.config.use_ssl { "https" } else { "http" };

        let uri = format!("{}://{}{}", scheme, self.host(), path);
        let parsed = uri.parse()?;

        Ok(parsed)
    }

    fn build_body(columns: &[String], records: &[ClickHouseRecord]) -> String {
        let value_list = records
            .iter()
            .map(|record| {
                columns
                    .iter()
                    .map(|column| match record.get(column) {
                        Some(value) => value.clickhouse_to_string(),
                        None => "NULL".to_string(),
                    })
                    .collect::<Vec<String>>()
                    .join(",")
            })
            .collect::<Vec<String>>()
            .join("),(");

        format!("({value_list})")
    }

    pub async fn insert(
        &self,
        table_name: &str,
        columns: &[String],
        records: &[ClickHouseRecord],
    ) -> anyhow::Result<()> {
        // TODO - this could be optimized with RowBinary instead
        let insert_query = format!(
            "INSERT INTO \"{}\".\"{}\" ({}) VALUES",
            self.config.db_name,
            table_name,
            wrap_and_join_column_names(columns, ","),
        );

        debug!("Inserting into clickhouse: {}", insert_query);

        let query: String = query_param(&insert_query, None)?;
        let uri = self.uri(format!("/?{query}"))?;

        let body = Self::build_body(columns, records);

        tracing::trace!("Inserting into clickhouse with values: {}", body);

        let bytes = Bytes::from(body);

        let req = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Host", self.host())
            .header("Authorization", self.auth_header())
            .header("Content-Length", bytes.len())
            .body(Full::new(bytes))?;

        let res = self.request(req, MAX_RETRIES, BACKOFF_START_MILLIS).await?;

        let status = res.status();

        if status != 200 {
            let body = res.collect().await?.to_bytes().to_vec();
            let body_str = String::from_utf8(body)?;
            error!(
                "Failed to insert into clickhouse: Res {} - {}",
                &status, body_str
            );

            Err(anyhow::anyhow!(
                "Failed to insert into clickhouse: {}",
                body_str
            ))
        } else {
            Ok(())
        }
    }

    /// Executes a SQL statement without a body (e.g., INSERT...SELECT, CREATE TABLE, etc.)
    ///
    /// # Arguments
    /// * `sql` - The SQL statement to execute
    /// * `database` - Optional database to use as the default context for this query
    pub async fn execute_sql_with_database(
        &self,
        sql: &str,
        database: Option<&str>,
    ) -> anyhow::Result<String> {
        let query: String = query_param(sql, database)?;
        let uri = self.uri(format!("/?{query}"))?;
        let req = Request::builder()
            .method("POST")
            .uri(uri)
            .header("Host", self.host())
            .header("Authorization", self.auth_header())
            .header("Content-Length", 0)
            .body(Full::new(Bytes::new()))?;
        let res = self.request(req, MAX_RETRIES, BACKOFF_START_MILLIS).await?;
        let status = res.status();
        let response_body = res.collect().await?.to_bytes().to_vec();
        let body_str = String::from_utf8(response_body)?;

        if status != 200 {
            error!("Failed to execute SQL: Res {} - {}", &status, body_str);
            Err(anyhow::anyhow!("Failed to execute SQL: {}", body_str))
        } else {
            debug!("SQL executed successfully: {}", sql);
            Ok(body_str.trim().to_string())
        }
    }

    /// Executes a SQL statement without a body (e.g., INSERT...SELECT, CREATE TABLE, etc.)
    pub async fn execute_sql(&self, sql: &str) -> anyhow::Result<String> {
        self.execute_sql_with_database(sql, None).await
    }
}

const DDL_COMMANDS: &[&str] = &["INSERT", "CREATE", "ALTER", "DROP", "TRUNCATE"];

fn query_param(query: &str, database: Option<&str>) -> anyhow::Result<String> {
    let mut params = vec![("query", query), ("date_time_input_format", "best_effort")];

    // Add database parameter if provided to set the default database context
    if let Some(db) = database {
        params.push(("database", db));
    }

    // Only add wait_end_of_query for INSERT and DDL operations to ensure at least once delivery
    // This preserves SELECT query performance by avoiding response buffering
    let query_upper = query.trim().to_uppercase();
    if DDL_COMMANDS.iter().any(|cmd| query_upper.starts_with(cmd)) {
        params.push(("wait_end_of_query", "1"));
    }

    let encoded = serde_urlencoded::to_string(&params)?;
    Ok(encoded)
}

#[async_trait]
pub trait ClickHouseClientTrait: Send + Sync {
    async fn insert(
        &self,
        table: &str,
        columns: &[String],
        records: &[ClickHouseRecord],
    ) -> anyhow::Result<()>;
}

#[async_trait]
impl ClickHouseClientTrait for ClickHouseClient {
    async fn insert(
        &self,
        table: &str,
        columns: &[String],
        records: &[ClickHouseRecord],
    ) -> anyhow::Result<()> {
        // Call the actual implementation
        self.insert(table, columns, records).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_param_insert_includes_wait_end_of_query() {
        let query = "INSERT INTO table VALUES (1, 'test')";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "INSERT query should include wait_end_of_query parameter"
        );
        assert!(
            result.contains("date_time_input_format=best_effort"),
            "Should include default date_time_input_format parameter"
        );
    }

    #[test]
    fn test_query_param_create_includes_wait_end_of_query() {
        let query = "CREATE TABLE test (id Int32, name String)";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "CREATE query should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_alter_includes_wait_end_of_query() {
        let query = "ALTER TABLE test ADD COLUMN age Int32";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "ALTER query should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_drop_includes_wait_end_of_query() {
        let query = "DROP TABLE test";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "DROP query should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_truncate_includes_wait_end_of_query() {
        let query = "TRUNCATE TABLE test";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "TRUNCATE query should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_select_excludes_wait_end_of_query() {
        let query = "SELECT * FROM table WHERE id = 1";
        let result = query_param(query, None).unwrap();
        assert!(!result.contains("wait_end_of_query"),
                "SELECT query should NOT include wait_end_of_query parameter to preserve streaming performance");
        assert!(
            result.contains("date_time_input_format=best_effort"),
            "Should still include default date_time_input_format parameter"
        );
    }

    #[test]
    fn test_query_param_show_excludes_wait_end_of_query() {
        let query = "SHOW TABLES";
        let result = query_param(query, None).unwrap();
        assert!(
            !result.contains("wait_end_of_query"),
            "SHOW query should NOT include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_describe_excludes_wait_end_of_query() {
        let query = "DESCRIBE table";
        let result = query_param(query, None).unwrap();
        assert!(
            !result.contains("wait_end_of_query"),
            "DESCRIBE query should NOT include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_with_leading_whitespace() {
        let query = "   INSERT INTO table VALUES (1, 'test')";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "INSERT query with leading whitespace should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_case_insensitive() {
        let query = "insert into table values (1, 'test')";
        let result = query_param(query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "Lowercase INSERT query should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_query_param_with_database() {
        let query = "SELECT * FROM table";
        let result = query_param(query, Some("test_db")).unwrap();
        assert!(
            result.contains("database=test_db"),
            "Should include database parameter when provided"
        );
    }
}
