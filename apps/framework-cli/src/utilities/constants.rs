use lazy_static::lazy_static;
use std::collections::HashMap;
use uuid::Uuid;

pub const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const ENVIRONMENT_VARIABLE_PREFIX: &str = "MOOSE";

pub const PACKAGE_JSON: &str = "package.json";
pub const PACKAGE_LOCK_JSON: &str = "package-lock.json";
pub const PNPM_LOCK: &str = "pnpm-lock.yaml";
pub const YARN_LOCK: &str = "yarn.lock";
pub const TSCONFIG_JSON: &str = "tsconfig.json";
pub const SETUP_PY: &str = "setup.py";
pub const LIB_DIR: &str = "lib";
pub const PYTHON_MINIMUM_VERSION: &str = "3.12";
pub const REQUIREMENTS_TXT: &str = "requirements.txt";
pub const OLD_PROJECT_CONFIG_FILE: &str = "project.toml";
pub const PROJECT_CONFIG_FILE: &str = "moose.config.toml";
pub const OPENAPI_FILE: &str = "openapi.yaml";
pub const WORKFLOW_CONFIGS: &str = "workflow_configs.json";
pub const PROJECT_NAME_ALLOW_PATTERN: &str = r"^[a-zA-Z0-9_-]+$";

pub const CLI_CONFIG_FILE: &str = "config.toml";
pub const CLI_USER_DIRECTORY: &str = ".moose";
pub const CLI_PROJECT_INTERNAL_DIR: &str = ".moose";
pub const CLI_INTERNAL_VERSIONS_DIR: &str = "versions";
pub const CLI_DEV_REDPANDA_VOLUME_DIR: &str = "redpanda";
pub const CLI_DEV_CLICKHOUSE_VOLUME_DIR_LOGS: &str = "clickhouse/logs";
pub const CLI_DEV_CLICKHOUSE_VOLUME_DIR_DATA: &str = "clickhouse/data";
pub const CLI_DEV_CLICKHOUSE_VOLUME_DIR_CONFIG_SCRIPTS: &str = "clickhouse/configs/scripts";
pub const CLI_DEV_CLICKHOUSE_VOLUME_DIR_CONFIG_USERS: &str = "clickhouse/configs/users";
pub const CLI_DEV_TEMPORAL_DYNAMIC_CONFIG_DIR: &str = "temporal/dynamicconfig";

pub const SCHEMAS_DIR: &str = "datamodels";
pub const FUNCTIONS_DIR: &str = "functions";
pub const BLOCKS_DIR: &str = "blocks";
pub const CONSUMPTION_DIR: &str = "apis";
pub const VSCODE_DIR: &str = ".vscode";
pub const SAMPLE_STREAMING_FUNCTION_SOURCE: &str = "Foo";
pub const SAMPLE_STREAMING_FUNCTION_DEST: &str = "Bar";

pub const CLICKHOUSE_CONTAINER_NAME: &str = "clickhousedb";
pub const REDPANDA_CONTAINER_NAME: &str = "redpanda";
pub const TEMPORAL_CONTAINER_NAME: &str = "temporal";

pub const REDPANDA_HOSTS: [&str; 2] = ["redpanda", "localhost"];

pub const APP_DIR: &str = "app";
pub const APP_DIR_LAYOUT: [&str; 4] = [SCHEMAS_DIR, FUNCTIONS_DIR, BLOCKS_DIR, CONSUMPTION_DIR];

pub const GITIGNORE: &str = ".gitignore";

// These two constants are for the old convention of nested directories
// we will not be renaming them
pub const TS_FLOW_FILE: &str = "flow.ts";
pub const PY_FLOW_FILE: &str = "flow.py";

pub const TS_BLOCKS_FILE: &str = "Bar.ts";
pub const PY_BLOCKS_FILE: &str = "Bar.py";

pub const TS_API_FILE: &str = "bar.ts";
pub const PY_API_FILE: &str = "bar.py";

pub const VSCODE_EXT_FILE: &str = "extensions.json";
pub const VSCODE_SETTINGS_FILE: &str = "settings.json";

pub const CTX_SESSION_ID: &str = "session_id";

pub const PYTHON_FILE_EXTENSION: &str = "py";
pub const TYPESCRIPT_FILE_EXTENSION: &str = "ts";
pub const SQL_FILE_EXTENSION: &str = "sql";

pub const PYTHON_CACHE_EXTENSION: &str = "pyc";
pub const PYTHON_INIT_FILE: &str = "__init__.py";

lazy_static! {
    pub static ref CONTEXT: HashMap<String, String> = {
        let mut map = HashMap::new();
        map.insert(CTX_SESSION_ID.to_string(), Uuid::new_v4().to_string());
        map
    };
}

pub const README_PREFIX: &str = r#"
This is a [MooseJs](https://www.moosejs.com/) project bootstrapped with the 
[`Moose CLI`](https://github.com/514-labs/moose/tree/main/apps/framework-cli).

"#;

pub const PYTHON_WORKER_WRAPPER_PACKAGE_NAME: &str = "python_worker_wrapper";
pub const CONSUMPTION_WRAPPER_PACKAGE_NAME: &str = "consumption_wrapper";
pub const UTILS_WRAPPER_PACKAGE_NAME: &str = "utils";

pub const PYTHON_MAIN_FILE: &str = "main.py";
pub const TYPESCRIPT_MAIN_FILE: &str = "index.ts";
pub const PYTHON_EXTERNAL_FILE: &str = "external_models.py";
pub const TYPESCRIPT_EXTERNAL_FILE: &str = "externalModels.ts";

pub const WORKFLOW_TYPE: &str = "ScriptWorkflow";
pub const PYTHON_TASK_QUEUE: &str = "python-script-queue";
pub const TYPESCRIPT_TASK_QUEUE: &str = "typescript-script-queue";
pub const MOOSE_CLI_NAME: &str = "moose-cli";
pub const KEY_REMOTE_CLICKHOUSE_URL: &str = "remote_clickhouse_url";
pub const KEY_REMOTE_ADMIN_URL: &str = "remote_admin_url";
pub const KEY_REMOTE_ADMIN_TOKEN: &str = "remote_admin_token";

pub const MIGRATION_FILE: &str = "./migrations/plan.yaml";
pub const MIGRATION_BEFORE_STATE_FILE: &str = "./migrations/remote_state.json";
pub const MIGRATION_AFTER_STATE_FILE: &str = "./migrations/local_infra_map.json";
