use crate::project::Project;
use anyhow::{Context, Result};
use chrono::{SecondsFormat, Utc};
use reqwest::{Certificate, StatusCode};
use serde_json::{Map, Value};
use std::fs;
use std::time::Duration;
use tokio::time::{sleep, Instant};
use tracing::{debug, info, warn};

const DEFAULT_API_SERVER: &str = "https://kubernetes.default.svc";
const SERVICEACCOUNT_TOKEN_PATH: &str = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SERVICEACCOUNT_CA_PATH: &str = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const SERVICEACCOUNT_NAMESPACE_PATH: &str =
    "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

const STATUS_ANNOTATION: &str = "moose.sh/migration-status";
const APPLIED_BY_ANNOTATION: &str = "moose.sh/applied-by";
const COMPLETED_AT_ANNOTATION: &str = "moose.sh/completed-at";
const ERROR_ANNOTATION: &str = "moose.sh/error-summary";
const STARTED_AT_ANNOTATION: &str = "moose.sh/started-at";
const LEASE_POLL_INTERVAL_SECS: u64 = 2;
const TERMINAL_STATUS_UPDATE_RETRIES: usize = 5;
const ERROR_SUMMARY_MAX_LEN: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LeaseRole {
    Leader,
    Follower,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LeaseStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct DynamicMigrationLeaseGuard {
    role: LeaseRole,
    holder_id: String,
    lease_name: String,
    client: KubernetesLeaseClient,
}

impl DynamicMigrationLeaseGuard {
    fn new(
        role: LeaseRole,
        holder_id: String,
        lease_name: String,
        client: KubernetesLeaseClient,
    ) -> Self {
        Self {
            role,
            holder_id,
            lease_name,
            client,
        }
    }

    pub fn is_leader(&self) -> bool {
        self.role == LeaseRole::Leader
    }

    pub async fn mark_completed(&self) -> Result<()> {
        if self.role != LeaseRole::Leader {
            return Ok(());
        }

        self.update_terminal_status("completed", None).await
    }

    pub async fn mark_failed(&self, error_summary: &str) -> Result<()> {
        if self.role != LeaseRole::Leader {
            return Ok(());
        }

        self.update_terminal_status("failed", Some(error_summary))
            .await
    }

    async fn update_terminal_status(
        &self,
        status: &str,
        error_summary: Option<&str>,
    ) -> Result<()> {
        for attempt in 1..=TERMINAL_STATUS_UPDATE_RETRIES {
            let mut lease = self.client.get_lease(&self.lease_name).await?;
            set_status(&mut lease, status)?;
            set_annotation(&mut lease, APPLIED_BY_ANNOTATION, &self.holder_id)?;
            set_annotation(&mut lease, COMPLETED_AT_ANNOTATION, &now_rfc3339())?;
            set_spec_string_field(&mut lease, "holderIdentity", &self.holder_id)?;

            if let Some(summary) = error_summary {
                let truncated = truncate_error_summary(summary);
                set_annotation(&mut lease, ERROR_ANNOTATION, &truncated)?;
            } else {
                remove_annotation(&mut lease, ERROR_ANNOTATION)?;
            }

            match self.client.update_lease(&self.lease_name, &lease).await {
                Ok(_) => {
                    info!(
                        "Updated Kubernetes migration lease '{}' to terminal status '{}'",
                        self.lease_name, status
                    );
                    return Ok(());
                }
                Err(LeaseClientError::Conflict) if attempt < TERMINAL_STATUS_UPDATE_RETRIES => {
                    debug!(
                        "Lease '{}' conflict while setting status '{}', retrying (attempt {}/{})",
                        self.lease_name, status, attempt, TERMINAL_STATUS_UPDATE_RETRIES
                    );
                }
                Err(e) => {
                    return Err(anyhow::anyhow!(
                        "Failed to update lease '{}' to status '{}': {}",
                        self.lease_name,
                        status,
                        e
                    ));
                }
            }
        }

        anyhow::bail!(
            "Failed to update lease '{}' to terminal status '{}' after {} retries",
            self.lease_name,
            status,
            TERMINAL_STATUS_UPDATE_RETRIES
        );
    }
}

#[derive(Debug, thiserror::Error)]
enum LeaseClientError {
    #[error("Lease not found")]
    NotFound,
    #[error("Lease update conflict")]
    Conflict,
    #[error("Lease API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("Lease transport error: {0}")]
    Transport(String),
    #[error("Lease parse error: {0}")]
    Parse(String),
}

#[derive(Debug, Clone)]
struct KubernetesLeaseClient {
    http_client: reqwest::Client,
    api_server: String,
    namespace: String,
    token: String,
}

impl KubernetesLeaseClient {
    fn in_cluster(namespace: String) -> Result<Self> {
        let token = fs::read_to_string(SERVICEACCOUNT_TOKEN_PATH)
            .with_context(|| format!("Failed to read {}", SERVICEACCOUNT_TOKEN_PATH))?
            .trim()
            .to_string();
        if token.is_empty() {
            anyhow::bail!("Kubernetes service account token is empty");
        }

        let ca_pem = fs::read(SERVICEACCOUNT_CA_PATH)
            .with_context(|| format!("Failed to read {}", SERVICEACCOUNT_CA_PATH))?;
        let cert = Certificate::from_pem(&ca_pem)
            .context("Failed to parse Kubernetes service account CA certificate")?;

        let http_client = reqwest::Client::builder()
            .add_root_certificate(cert)
            .build()
            .context("Failed to build Kubernetes Lease HTTP client")?;

        Ok(Self {
            http_client,
            api_server: kubernetes_api_server(),
            namespace,
            token,
        })
    }

    async fn get_lease(&self, lease_name: &str) -> Result<Value, LeaseClientError> {
        let response = self
            .http_client
            .get(self.lease_url(lease_name))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| LeaseClientError::Transport(e.to_string()))?;

        self.parse_json_response(response).await
    }

    async fn update_lease(
        &self,
        lease_name: &str,
        lease: &Value,
    ) -> Result<Value, LeaseClientError> {
        let response = self
            .http_client
            .put(self.lease_url(lease_name))
            .bearer_auth(&self.token)
            .json(lease)
            .send()
            .await
            .map_err(|e| LeaseClientError::Transport(e.to_string()))?;

        self.parse_json_response(response).await
    }

    fn lease_url(&self, lease_name: &str) -> String {
        format!(
            "{}/apis/coordination.k8s.io/v1/namespaces/{}/leases/{}",
            self.api_server, self.namespace, lease_name
        )
    }

    async fn parse_json_response(
        &self,
        response: reqwest::Response,
    ) -> Result<Value, LeaseClientError> {
        let status = response.status();
        let body_text = response
            .text()
            .await
            .map_err(|e| LeaseClientError::Transport(e.to_string()))?;

        match status {
            StatusCode::NOT_FOUND => Err(LeaseClientError::NotFound),
            StatusCode::CONFLICT => Err(LeaseClientError::Conflict),
            s if !s.is_success() => Err(LeaseClientError::Api {
                status: s.as_u16(),
                message: body_text,
            }),
            _ => {
                serde_json::from_str(&body_text).map_err(|e| LeaseClientError::Parse(e.to_string()))
            }
        }
    }
}

pub async fn maybe_acquire_dynamic_migration_lease(
    project: &Project,
) -> Result<Option<DynamicMigrationLeaseGuard>> {
    if !project.migration_coordinator.is_kubernetes_lease_mode() {
        return Ok(None);
    }

    let kube_cfg = &project.migration_coordinator.kubernetes;

    let namespace = resolve_namespace(kube_cfg.namespace.as_deref())
        .context("Failed to resolve Kubernetes namespace for lease coordination")?;

    let deployment_id = kube_cfg
        .deployment_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Kubernetes lease mode requires migration_coordinator.kubernetes.deployment_id"
            )
        })?;

    let holder_id = kube_cfg
        .pod_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_else(|| "unknown-pod".to_string());

    let lease_name = build_lease_name(&kube_cfg.lease_name_prefix, deployment_id)?;
    let fail_closed = kube_cfg.fail_closed || project.is_production;

    let client = match KubernetesLeaseClient::in_cluster(namespace.clone()) {
        Ok(client) => client,
        Err(e) => {
            if fail_closed {
                return Err(e).context(
                    "Kubernetes lease mode is enabled but in-cluster client initialization failed",
                );
            }
            warn!("Kubernetes lease client initialization failed (fail_closed=false): {e}");
            return Ok(None);
        }
    };

    info!(
        "Kubernetes lease coordination enabled for deployment '{}' (lease='{}', namespace='{}')",
        deployment_id, lease_name, namespace
    );

    match wait_for_or_claim_lease(
        &client,
        &lease_name,
        &holder_id,
        kube_cfg.wait_timeout_seconds,
    )
    .await
    {
        Ok(role) => Ok(Some(DynamicMigrationLeaseGuard::new(
            role, holder_id, lease_name, client,
        ))),
        Err(e) => {
            if fail_closed {
                Err(e)
            } else {
                warn!("Lease gating failed with fail_closed=false; continuing without lease gate: {e}");
                Ok(None)
            }
        }
    }
}

async fn wait_for_or_claim_lease(
    client: &KubernetesLeaseClient,
    lease_name: &str,
    holder_id: &str,
    wait_timeout_seconds: u64,
) -> Result<LeaseRole> {
    let timeout = Duration::from_secs(wait_timeout_seconds.max(1));
    let deadline = Instant::now() + timeout;

    loop {
        if Instant::now() > deadline {
            anyhow::bail!(
                "Timed out waiting for migration lease '{}' to become completed",
                lease_name
            );
        }

        let lease = match client.get_lease(lease_name).await {
            Ok(lease) => lease,
            Err(LeaseClientError::NotFound) => {
                anyhow::bail!(
                    "No Kubernetes migration lease '{}' found while lease mode is enabled",
                    lease_name
                );
            }
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Failed to fetch lease '{}': {}",
                    lease_name,
                    e
                ))
            }
        };

        match lease_status(&lease) {
            LeaseStatus::Completed => {
                info!(
                    "Migration lease '{}' is already completed; skipping migration execution",
                    lease_name
                );
                return Ok(LeaseRole::Follower);
            }
            LeaseStatus::Failed => {
                anyhow::bail!(
                    "Migration lease '{}' is marked failed: {}",
                    lease_name,
                    lease_error_summary(&lease)
                        .unwrap_or_else(|| "no error summary provided".to_string())
                );
            }
            LeaseStatus::Pending => {
                match try_claim_lease(client, lease_name, lease, holder_id).await {
                    Ok(true) => {
                        info!(
                            "Claimed migration lease '{}' as holder '{}'",
                            lease_name, holder_id
                        );
                        return Ok(LeaseRole::Leader);
                    }
                    Ok(false) => {}
                    Err(LeaseClientError::Conflict) => {
                        debug!("Lease '{}' claim conflict; retrying", lease_name);
                    }
                    Err(e) => {
                        return Err(anyhow::anyhow!(
                            "Failed claiming migration lease '{}': {}",
                            lease_name,
                            e
                        ));
                    }
                }
            }
            LeaseStatus::InProgress => {
                let Some(current_holder) = lease_holder(&lease) else {
                    anyhow::bail!(
                        "Lease '{}' is in_progress but missing spec.holderIdentity",
                        lease_name
                    );
                };

                if current_holder == holder_id {
                    info!(
                        "Lease '{}' already held by current holder '{}' (resuming as leader)",
                        lease_name, holder_id
                    );
                    return Ok(LeaseRole::Leader);
                }
                debug!(
                    "Lease '{}' is in progress by '{}'; waiting for completion",
                    lease_name, current_holder
                );
            }
            LeaseStatus::Unknown => {
                anyhow::bail!(
                    "Lease '{}' has unknown migration status annotation",
                    lease_name
                );
            }
        }

        sleep(Duration::from_secs(LEASE_POLL_INTERVAL_SECS)).await;
    }
}

async fn try_claim_lease(
    client: &KubernetesLeaseClient,
    lease_name: &str,
    mut lease: Value,
    holder_id: &str,
) -> Result<bool, LeaseClientError> {
    if lease_status(&lease) != LeaseStatus::Pending {
        return Ok(false);
    }

    set_status(&mut lease, "in_progress").map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    set_annotation(&mut lease, APPLIED_BY_ANNOTATION, holder_id)
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    set_annotation(&mut lease, STARTED_AT_ANNOTATION, &now_rfc3339())
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    remove_annotation(&mut lease, COMPLETED_AT_ANNOTATION)
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    remove_annotation(&mut lease, ERROR_ANNOTATION)
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    set_spec_string_field(&mut lease, "holderIdentity", holder_id)
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    set_spec_string_field(&mut lease, "acquireTime", &now_rfc3339())
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;
    set_spec_string_field(&mut lease, "renewTime", &now_rfc3339())
        .map_err(|e| LeaseClientError::Parse(e.to_string()))?;

    client.update_lease(lease_name, &lease).await?;
    Ok(true)
}

fn lease_status(lease: &Value) -> LeaseStatus {
    match lease_annotation(lease, STATUS_ANNOTATION)
        .unwrap_or_else(|| "pending".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "pending" => LeaseStatus::Pending,
        "in_progress" => LeaseStatus::InProgress,
        "completed" => LeaseStatus::Completed,
        "failed" => LeaseStatus::Failed,
        _ => LeaseStatus::Unknown,
    }
}

fn lease_holder(lease: &Value) -> Option<String> {
    lease
        .get("spec")
        .and_then(Value::as_object)
        .and_then(|spec| spec.get("holderIdentity"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn lease_annotation(lease: &Value, key: &str) -> Option<String> {
    lease
        .get("metadata")
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("annotations"))
        .and_then(Value::as_object)
        .and_then(|annotations| annotations.get(key))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn lease_error_summary(lease: &Value) -> Option<String> {
    lease_annotation(lease, ERROR_ANNOTATION)
}

fn set_status(lease: &mut Value, status: &str) -> Result<()> {
    set_annotation(lease, STATUS_ANNOTATION, status)
}

fn set_annotation(lease: &mut Value, key: &str, value: &str) -> Result<()> {
    let annotations = annotations_mut(lease)?;
    annotations.insert(key.to_string(), Value::String(value.to_string()));
    Ok(())
}

fn remove_annotation(lease: &mut Value, key: &str) -> Result<()> {
    let annotations = annotations_mut(lease)?;
    annotations.remove(key);
    Ok(())
}

fn set_spec_string_field(lease: &mut Value, key: &str, value: &str) -> Result<()> {
    let spec = spec_mut(lease)?;
    spec.insert(key.to_string(), Value::String(value.to_string()));
    Ok(())
}

fn annotations_mut(lease: &mut Value) -> Result<&mut Map<String, Value>> {
    let metadata = metadata_mut(lease)?;
    let annotations = metadata
        .entry("annotations")
        .or_insert_with(|| Value::Object(Map::new()));
    annotations
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Lease metadata.annotations is not an object"))
}

fn metadata_mut(lease: &mut Value) -> Result<&mut Map<String, Value>> {
    let root = lease
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Lease payload is not an object"))?;
    let metadata = root
        .entry("metadata")
        .or_insert_with(|| Value::Object(Map::new()));
    metadata
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Lease metadata is not an object"))
}

fn spec_mut(lease: &mut Value) -> Result<&mut Map<String, Value>> {
    let root = lease
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Lease payload is not an object"))?;
    let spec = root
        .entry("spec")
        .or_insert_with(|| Value::Object(Map::new()));
    spec.as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("Lease spec is not an object"))
}

fn resolve_namespace(explicit_namespace: Option<&str>) -> Result<String> {
    if let Some(ns) = explicit_namespace.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(ns.to_string());
    }

    let from_file = fs::read_to_string(SERVICEACCOUNT_NAMESPACE_PATH)
        .with_context(|| format!("Failed to read {}", SERVICEACCOUNT_NAMESPACE_PATH))?;
    let namespace = from_file.trim();
    if namespace.is_empty() {
        anyhow::bail!("Kubernetes namespace file is empty");
    }
    Ok(namespace.to_string())
}

fn build_lease_name(prefix: &str, deployment_id: &str) -> Result<String> {
    let prefix = sanitize_lease_token(prefix).unwrap_or_default();
    let deployment = sanitize_lease_token(deployment_id).ok_or_else(|| {
        anyhow::anyhow!("deployment_id is invalid after Kubernetes name sanitization")
    })?;

    let mut lease_name = if prefix.is_empty() {
        deployment
    } else {
        format!("{prefix}-{deployment}")
    };

    if lease_name.len() > 253 {
        lease_name.truncate(253);
        lease_name = trim_non_alnum_edges(&lease_name).to_string();
    }

    if lease_name.is_empty() {
        anyhow::bail!("constructed lease name is empty after sanitization");
    }

    Ok(lease_name)
}

fn sanitize_lease_token(input: &str) -> Option<String> {
    let mut out = String::with_capacity(input.len());
    let mut last_was_sep = false;

    for c in input.trim().chars() {
        let mapped = if c.is_ascii_lowercase() || c.is_ascii_digit() {
            c
        } else if c.is_ascii_uppercase() {
            c.to_ascii_lowercase()
        } else if c == '-' || c == '.' || c == '_' || c.is_whitespace() {
            '-'
        } else {
            '-'
        };

        if mapped == '-' || mapped == '.' {
            if last_was_sep {
                continue;
            }
            last_was_sep = true;
        } else {
            last_was_sep = false;
        }

        out.push(mapped);
    }

    let trimmed = trim_non_alnum_edges(&out).to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn trim_non_alnum_edges(input: &str) -> &str {
    input.trim_matches(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
}

fn kubernetes_api_server() -> String {
    match (
        std::env::var("KUBERNETES_SERVICE_HOST"),
        std::env::var("KUBERNETES_SERVICE_PORT_HTTPS")
            .or_else(|_| std::env::var("KUBERNETES_SERVICE_PORT")),
    ) {
        (Ok(host), Ok(port)) if !host.is_empty() && !port.is_empty() => {
            format!("https://{host}:{port}")
        }
        _ => DEFAULT_API_SERVER.to_string(),
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn truncate_error_summary(summary: &str) -> String {
    let mut truncated = summary.trim().to_string();
    if truncated.len() > ERROR_SUMMARY_MAX_LEN {
        let safe_boundary = truncated.floor_char_boundary(ERROR_SUMMARY_MAX_LEN);
        truncated.truncate(safe_boundary);
    }
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_build_lease_name() {
        assert_eq!(
            build_lease_name("moose-migration", "abc123").unwrap(),
            "moose-migration-abc123"
        );
        assert_eq!(
            build_lease_name("moose-migration-", "abc123").unwrap(),
            "moose-migration-abc123"
        );
        assert_eq!(build_lease_name("", "abc123").unwrap(), "abc123");
    }

    #[test]
    fn test_build_lease_name_sanitizes_input() {
        assert_eq!(
            build_lease_name("Moose_Migration", "Deploy/ABC 123").unwrap(),
            "moose-migration-deploy-abc-123"
        );
    }

    #[test]
    fn test_lease_status_defaults_to_pending() {
        let lease = json!({
            "metadata": {
                "annotations": {}
            }
        });
        assert_eq!(lease_status(&lease), LeaseStatus::Pending);
    }

    #[test]
    fn test_set_and_remove_annotation() {
        let mut lease = json!({
            "metadata": {
                "annotations": {}
            }
        });

        set_annotation(&mut lease, STATUS_ANNOTATION, "in_progress").unwrap();
        assert_eq!(
            lease_annotation(&lease, STATUS_ANNOTATION).unwrap(),
            "in_progress"
        );

        remove_annotation(&mut lease, STATUS_ANNOTATION).unwrap();
        assert!(lease_annotation(&lease, STATUS_ANNOTATION).is_none());
    }
}
