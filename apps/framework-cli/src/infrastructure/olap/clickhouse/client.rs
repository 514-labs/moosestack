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
use super::errors::{validate_clickhouse_identifier, ClickhouseError};
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

    /// Inserts records into a ClickHouse table.
    ///
    /// # Arguments
    /// * `table_name` - The name of the table to insert into
    /// * `database` - Optional database name. If None, uses the config's default database
    /// * `columns` - The column names to insert
    /// * `records` - The records to insert
    pub async fn insert(
        &self,
        table_name: &str,
        database: Option<&str>,
        columns: &[String],
        records: &[ClickHouseRecord],
    ) -> anyhow::Result<()> {
        let target_db = database.unwrap_or(&self.config.db_name);
        // TODO - this could be optimized with RowBinary instead
        let insert_query = build_insert_query(target_db, table_name, columns);

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

    /// Checks if a table exists in the specified database
    ///
    /// # Arguments
    /// * `database` - The database name
    /// * `table_name` - The table name
    ///
    /// # Returns
    /// `Ok(true)` if the table exists, `Ok(false)` if it doesn't, `Err` on query failure
    #[allow(dead_code)]
    pub async fn table_exists(&self, database: &str, table_name: &str) -> anyhow::Result<bool> {
        let query = build_exists_table_query(database, table_name)?;
        let result = self.execute_sql(&query).await?;
        Ok(result.trim() == "1")
    }

    /// Drops a table if it exists in the specified database
    ///
    /// # Arguments
    /// * `database` - The database name
    /// * `table_name` - The table name
    ///
    /// # Returns
    /// `Ok(())` on success, `Err` on failure
    #[allow(dead_code)]
    pub async fn drop_table_if_exists(
        &self,
        database: &str,
        table_name: &str,
    ) -> anyhow::Result<()> {
        let query = build_drop_table_query(database, table_name)?;
        self.execute_sql(&query).await?;
        Ok(())
    }
}

const DDL_COMMANDS: &[&str] = &["INSERT", "CREATE", "ALTER", "DROP", "TRUNCATE"];

/// Builds an INSERT query string for a ClickHouse table.
///
/// # Arguments
/// * `database` - The database name
/// * `table_name` - The table name
/// * `columns` - The column names to insert
///
/// # Returns
/// A formatted INSERT query string like: `INSERT INTO "db"."table" ("col1","col2") VALUES`
fn build_insert_query(database: &str, table_name: &str, columns: &[String]) -> String {
    format!(
        "INSERT INTO \"{}\".\"{}\" ({}) VALUES",
        database,
        table_name,
        wrap_and_join_column_names(columns, ","),
    )
}

/// Builds an EXISTS TABLE query string for a ClickHouse table.
///
/// # Arguments
/// * `database` - The database name (must be a valid identifier)
/// * `table_name` - The table name (must be a valid identifier)
///
/// # Returns
/// A formatted EXISTS TABLE query string like: `EXISTS TABLE "db"."table"`
///
/// # Errors
/// Returns an error if database or table_name contains invalid characters
fn build_exists_table_query(database: &str, table_name: &str) -> Result<String, ClickhouseError> {
    validate_clickhouse_identifier(database, "Database name")?;
    validate_clickhouse_identifier(table_name, "Table name")?;
    Ok(format!("EXISTS TABLE \"{}\".\"{}\"", database, table_name))
}

/// Builds a DROP TABLE IF EXISTS query string for a ClickHouse table.
///
/// # Arguments
/// * `database` - The database name (must be a valid identifier)
/// * `table_name` - The table name (must be a valid identifier)
///
/// # Returns
/// A formatted DROP TABLE IF EXISTS query string like: `DROP TABLE IF EXISTS "db"."table"`
///
/// # Errors
/// Returns an error if database or table_name contains invalid characters
fn build_drop_table_query(database: &str, table_name: &str) -> Result<String, ClickhouseError> {
    validate_clickhouse_identifier(database, "Database name")?;
    validate_clickhouse_identifier(table_name, "Table name")?;
    Ok(format!(
        "DROP TABLE IF EXISTS \"{}\".\"{}\"",
        database, table_name
    ))
}

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
    /// Inserts records into a ClickHouse table.
    ///
    /// # Arguments
    /// * `table` - The name of the table to insert into
    /// * `database` - Optional database name. If None, uses the client's default database
    /// * `columns` - The column names to insert
    /// * `records` - The records to insert
    async fn insert(
        &self,
        table: &str,
        database: Option<&str>,
        columns: &[String],
        records: &[ClickHouseRecord],
    ) -> anyhow::Result<()>;
}

#[async_trait]
impl ClickHouseClientTrait for ClickHouseClient {
    async fn insert(
        &self,
        table: &str,
        database: Option<&str>,
        columns: &[String],
        records: &[ClickHouseRecord],
    ) -> anyhow::Result<()> {
        // Call the actual implementation
        self.insert(table, database, columns, records).await
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

    #[test]
    fn test_build_insert_query_with_database() {
        let columns = vec!["id".to_string(), "name".to_string()];
        let result = build_insert_query("custom_db", "my_table", &columns);
        assert_eq!(
            result, "INSERT INTO \"custom_db\".\"my_table\" (`id`,`name`) VALUES",
            "Should build INSERT query with correct database and table"
        );
    }

    #[test]
    fn test_build_insert_query_with_default_database() {
        let columns = vec!["col1".to_string()];
        let result = build_insert_query("local", "test_table", &columns);
        assert!(
            result.contains(r#""local"."test_table""#),
            "Should use provided database in query"
        );
    }

    #[test]
    fn test_build_insert_query_with_special_characters() {
        let columns = vec!["user_id".to_string(), "event_time".to_string()];
        let result = build_insert_query("analytics_db", "user_events", &columns);
        assert_eq!(
            result, "INSERT INTO \"analytics_db\".\"user_events\" (`user_id`,`event_time`) VALUES",
            "Should handle underscores in database and table names"
        );
    }

    #[test]
    fn test_build_exists_table_query() {
        let result = build_exists_table_query("test_db", "my_table").unwrap();
        assert_eq!(
            result, "EXISTS TABLE \"test_db\".\"my_table\"",
            "Should build EXISTS TABLE query with double-quoted identifiers"
        );
    }

    #[test]
    fn test_build_exists_table_query_with_special_characters() {
        let result = build_exists_table_query("analytics_db", "user_events").unwrap();
        assert_eq!(
            result, "EXISTS TABLE \"analytics_db\".\"user_events\"",
            "Should handle underscores in database and table names"
        );
    }

    #[test]
    fn test_build_drop_table_query() {
        let result = build_drop_table_query("test_db", "my_table").unwrap();
        assert_eq!(
            result, "DROP TABLE IF EXISTS \"test_db\".\"my_table\"",
            "Should build DROP TABLE IF EXISTS query with double-quoted identifiers"
        );
    }

    #[test]
    fn test_build_drop_table_query_with_special_characters() {
        let result = build_drop_table_query("analytics_db", "user_events").unwrap();
        assert_eq!(
            result, "DROP TABLE IF EXISTS \"analytics_db\".\"user_events\"",
            "Should handle underscores in database and table names"
        );
    }

    #[test]
    fn test_exists_query_includes_wait_end_of_query() {
        // EXISTS is not a DDL command, so it should NOT include wait_end_of_query
        let query = build_exists_table_query("db", "my_table").unwrap();
        let result = query_param(&query, None).unwrap();
        assert!(
            !result.contains("wait_end_of_query"),
            "EXISTS query should NOT include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_drop_table_query_includes_wait_end_of_query() {
        // DROP is a DDL command, so it should include wait_end_of_query
        let query = build_drop_table_query("db", "my_table").unwrap();
        let result = query_param(&query, None).unwrap();
        assert!(
            result.contains("wait_end_of_query=1"),
            "DROP TABLE query should include wait_end_of_query parameter"
        );
    }

    #[test]
    fn test_validate_identifier_valid() {
        assert!(validate_clickhouse_identifier("test_db", "Database").is_ok());
        assert!(validate_clickhouse_identifier("my_table", "Table").is_ok());
        assert!(validate_clickhouse_identifier("Table123", "Table").is_ok());
        assert!(validate_clickhouse_identifier("_private", "Table").is_ok());
    }

    #[test]
    fn test_validate_identifier_empty() {
        let result = validate_clickhouse_identifier("", "Database");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cannot be empty"));
    }

    #[test]
    fn test_validate_identifier_invalid_characters() {
        let result = validate_clickhouse_identifier("my-table", "Table");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("invalid characters"));

        let result = validate_clickhouse_identifier("my.table", "Table");
        assert!(result.is_err());

        let result = validate_clickhouse_identifier("my table", "Table");
        assert!(result.is_err());

        // SQL injection attempt
        let result = validate_clickhouse_identifier("table\"; DROP TABLE users; --", "Table");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_identifier_starts_with_digit() {
        let result = validate_clickhouse_identifier("123table", "Table");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("cannot start with a digit"));
    }

    #[test]
    fn test_build_exists_table_query_rejects_invalid_identifiers() {
        // SQL injection attempt in database name
        let result = build_exists_table_query("db\"; DROP TABLE users; --", "table");
        assert!(result.is_err());

        // SQL injection attempt in table name
        let result = build_exists_table_query("db", "table\"; DROP TABLE users; --");
        assert!(result.is_err());
    }

    #[test]
    fn test_build_drop_table_query_rejects_invalid_identifiers() {
        // SQL injection attempt in database name
        let result = build_drop_table_query("db\"; DROP TABLE users; --", "table");
        assert!(result.is_err());

        // SQL injection attempt in table name
        let result = build_drop_table_query("db", "table\"; DROP TABLE users; --");
        assert!(result.is_err());
    }
}
