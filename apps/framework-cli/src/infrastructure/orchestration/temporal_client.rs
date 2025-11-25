use anyhow::{Error, Result};
use temporal_sdk_core_protos::temporal::api::workflowservice::v1::workflow_service_client::WorkflowServiceClient;
use temporal_sdk_core_protos::temporal::api::workflowservice::v1::{
    DescribeNamespaceRequest, DescribeNamespaceResponse, DescribeWorkflowExecutionRequest,
    DescribeWorkflowExecutionResponse, GetWorkflowExecutionHistoryRequest,
    GetWorkflowExecutionHistoryResponse, ListWorkflowExecutionsRequest,
    ListWorkflowExecutionsResponse, RequestCancelWorkflowExecutionRequest,
    RequestCancelWorkflowExecutionResponse, SignalWorkflowExecutionRequest,
    SignalWorkflowExecutionResponse, StartWorkflowExecutionRequest,
    TerminateWorkflowExecutionRequest, TerminateWorkflowExecutionResponse,
};
use tonic::service::interceptor::InterceptedService;
use tonic::transport::{Channel, Uri};
use tracing::info;

use crate::infrastructure::orchestration::temporal::{InvalidTemporalSchemeError, TemporalConfig};
use crate::project::Project;

pub struct TemporalClientManager {
    config: TemporalConfig,
    temporal_url: String,
    ca_cert: String,
    client_cert: String,
    client_key: String,
    api_key: String,
}

pub enum TemporalClient {
    Standard(WorkflowServiceClient<Channel>),
    WithInterceptor(WorkflowServiceClient<InterceptedService<Channel, ApiKeyInterceptor>>),
}

pub struct ApiKeyInterceptor {
    api_key: String,
    namespace: String,
}

impl tonic::service::Interceptor for ApiKeyInterceptor {
    fn call(
        &mut self,
        mut request: tonic::Request<()>,
    ) -> Result<tonic::Request<()>, tonic::Status> {
        request.metadata_mut().insert(
            "authorization",
            tonic::metadata::MetadataValue::try_from(format!("Bearer {}", self.api_key))
                .map_err(|_| tonic::Status::internal("Invalid metadata value"))?,
        );
        request.metadata_mut().insert(
            "temporal-namespace",
            tonic::metadata::MetadataValue::try_from(&self.namespace)
                .map_err(|_| tonic::Status::internal("Invalid metadata value"))?,
        );
        Ok(request)
    }
}

impl TemporalClientManager {
    pub fn new(config: &TemporalConfig) -> Result<Self, InvalidTemporalSchemeError> {
        Self::new_validate(config, true)
    }

    pub fn new_validate(
        config: &TemporalConfig,
        validate: bool,
    ) -> Result<Self, InvalidTemporalSchemeError> {
        Ok(Self {
            config: config.clone(),
            temporal_url: config.temporal_url_with_scheme_validate(validate)?,
            ca_cert: config.ca_cert.clone(),
            client_cert: config.client_cert.clone(),
            client_key: config.client_key.clone(),
            api_key: config.api_key.clone(),
        })
    }

    pub async fn execute<F, Fut, R>(&self, operation: F) -> Result<R>
    where
        F: FnOnce(TemporalClient) -> Fut,
        Fut: std::future::Future<Output = Result<R>>,
    {
        let client = self.get_client().await?;
        operation(client).await
    }

    async fn get_client(&self) -> Result<TemporalClient> {
        info!("Getting client for Temporal URL: {}", self.temporal_url);

        if !self.ca_cert.is_empty() && !self.client_cert.is_empty() && !self.client_key.is_empty() {
            info!("Choosing client with mTLS");
            let client = self.get_temporal_client_mtls().await?;
            Ok(TemporalClient::Standard(client))
        } else if !self.ca_cert.is_empty() && !self.api_key.is_empty() {
            info!("Choosing client with API key");
            let client = self.get_temporal_client_api_key().await?;
            Ok(TemporalClient::WithInterceptor(client))
        } else {
            info!("Choosing client with no authentication");
            let client = self.get_temporal_client().await?;
            Ok(TemporalClient::Standard(client))
        }
    }

    async fn get_temporal_client(&self) -> Result<WorkflowServiceClient<Channel>> {
        let endpoint: Uri = self.temporal_url.parse().unwrap();
        WorkflowServiceClient::connect(endpoint).await.map_err(|e| {
            eprintln!("{e}");
            Error::msg(format!(
                r#"Could not connect to Temporal: {e}

Please ensure the Temporal server is running.
Is the Moose development server running? Start it with `moose dev`."#
            ))
        })
    }

    async fn get_temporal_client_mtls(&self) -> Result<WorkflowServiceClient<Channel>> {
        let ca_cert_path = self.ca_cert.clone();
        let client_cert_path = self.client_cert.clone();
        let client_key_path = self.client_key.clone();

        let domain_name = self.config.get_temporal_domain_name();

        let client_identity = tonic::transport::Identity::from_pem(
            std::fs::read(client_cert_path).map_err(|e| Error::msg(e.to_string()))?,
            std::fs::read(client_key_path).map_err(|e| Error::msg(e.to_string()))?,
        );

        let ca_certificate = tonic::transport::Certificate::from_pem(
            std::fs::read(ca_cert_path).map_err(|e| Error::msg(e.to_string()))?,
        );

        let tls_config = tonic::transport::ClientTlsConfig::new()
            .identity(client_identity)
            .ca_certificate(ca_certificate)
            .domain_name(domain_name);

        let endpoint = tonic::transport::Channel::from_shared(self.temporal_url.to_string())
            .map_err(|e| Error::msg(e.to_string()))?;

        let client = WorkflowServiceClient::new(endpoint.tls_config(tls_config)?.connect().await?);

        Ok(client)
    }

    async fn get_temporal_client_api_key(
        &self,
    ) -> Result<WorkflowServiceClient<InterceptedService<Channel, ApiKeyInterceptor>>> {
        let ca_cert_path = self.ca_cert.clone();
        let api_key = self.api_key.clone();

        let namespace = self.config.get_temporal_namespace();

        let ca_certificate = tonic::transport::Certificate::from_pem(
            std::fs::read(ca_cert_path).map_err(|e| Error::msg(e.to_string()))?,
        );

        let regional_endpoint = self.config.get_temporal_api_key_endpoint();
        let domain_name = self.config.get_temporal_api_key_domain();
        info!(
            "Temporal API key mode: namespace='{}', endpoint='{}'",
            namespace, regional_endpoint
        );

        let endpoint = tonic::transport::Channel::from_shared(regional_endpoint)
            .map_err(|e| Error::msg(e.to_string()))?
            .tls_config(
                tonic::transport::ClientTlsConfig::new()
                    .domain_name(domain_name)
                    .ca_certificate(ca_certificate),
            )
            .map_err(|e| Error::msg(e.to_string()))?;

        let interceptor = ApiKeyInterceptor {
            api_key: api_key.to_string(),
            namespace: namespace.clone(),
        };

        let client = WorkflowServiceClient::with_interceptor(endpoint.connect_lazy(), interceptor);

        Ok(client)
    }
}

/// Convenience constructor to create a TemporalClientManager from a Project if workflows are enabled.
/// Returns None when workflows are disabled or config is invalid.
pub fn manager_from_project_if_enabled(project: &Project) -> Option<TemporalClientManager> {
    if !project.features.workflows {
        return None;
    }
    TemporalClientManager::new_validate(&project.temporal_config, true).ok()
}

/// Perform a lightweight probe against Temporal to establish/validate readiness.
/// The `label` is embedded in the query to allow distinguishing warmup vs ready calls.
pub async fn probe_temporal(
    manager: &TemporalClientManager,
    namespace: String,
    label: &str,
) -> Result<()> {
    let query = format!("WorkflowType!='__{}__'", label);
    manager
        .execute(move |mut c| async move {
            c.list_workflow_executions(ListWorkflowExecutionsRequest {
                namespace,
                query,
                page_size: 1,
                ..Default::default()
            })
            .await
            .map(|_| ())
        })
        .await
}

/// Probe Temporal readiness by calling DescribeNamespace, which requires only
/// namespace-level permissions and works with namespace-scoped API keys.
pub async fn probe_temporal_namespace(
    manager: &TemporalClientManager,
    namespace: String,
) -> Result<()> {
    info!("Probing Temporal namespace: '{}'", namespace);
    manager
        .execute(move |mut c| async move {
            c.describe_namespace(DescribeNamespaceRequest {
                namespace,
                ..Default::default()
            })
            .await
            .map(|_| ())
        })
        .await
}

impl TemporalClient {
    pub async fn start_workflow_execution(
        &mut self,
        request: StartWorkflowExecutionRequest,
    ) -> Result<String> {
        match self {
            TemporalClient::Standard(client) => {
                match client
                    .start_workflow_execution(tonic::Request::new(request))
                    .await
                {
                    Ok(response) => Ok(response.into_inner().run_id),
                    Err(status) => {
                        let concise_msg = format!(
                            "status: {code:?}, message: {message}",
                            code = status.code(),
                            message = status.message()
                        );
                        Err(anyhow::Error::msg(concise_msg))
                    }
                }
            }
            TemporalClient::WithInterceptor(client) => {
                match client
                    .start_workflow_execution(tonic::Request::new(request))
                    .await
                {
                    Ok(response) => Ok(response.into_inner().run_id),
                    Err(status) => {
                        let concise_msg = format!(
                            "status: {code:?}, message: {message}",
                            code = status.code(),
                            message = status.message()
                        );
                        Err(anyhow::Error::msg(concise_msg))
                    }
                }
            }
        }
    }

    pub async fn list_workflow_executions(
        &mut self,
        request: ListWorkflowExecutionsRequest,
    ) -> Result<tonic::Response<ListWorkflowExecutionsResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .list_workflow_executions(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .list_workflow_executions(request)
                .await
                .map_err(Error::from),
        }
    }

    pub async fn signal_workflow_execution(
        &mut self,
        request: SignalWorkflowExecutionRequest,
    ) -> Result<tonic::Response<SignalWorkflowExecutionResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .signal_workflow_execution(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .signal_workflow_execution(request)
                .await
                .map_err(Error::from),
        }
    }

    pub async fn terminate_workflow_execution(
        &mut self,
        request: TerminateWorkflowExecutionRequest,
    ) -> Result<tonic::Response<TerminateWorkflowExecutionResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .terminate_workflow_execution(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .terminate_workflow_execution(request)
                .await
                .map_err(Error::from),
        }
    }

    pub async fn request_cancel_workflow_execution(
        &mut self,
        request: RequestCancelWorkflowExecutionRequest,
    ) -> Result<tonic::Response<RequestCancelWorkflowExecutionResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .request_cancel_workflow_execution(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .request_cancel_workflow_execution(request)
                .await
                .map_err(Error::from),
        }
    }

    pub async fn describe_workflow_execution(
        &mut self,
        request: DescribeWorkflowExecutionRequest,
    ) -> Result<tonic::Response<DescribeWorkflowExecutionResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .describe_workflow_execution(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .describe_workflow_execution(request)
                .await
                .map_err(Error::from),
        }
    }

    pub async fn get_workflow_execution_history(
        &mut self,
        request: GetWorkflowExecutionHistoryRequest,
    ) -> Result<tonic::Response<GetWorkflowExecutionHistoryResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .get_workflow_execution_history(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .get_workflow_execution_history(request)
                .await
                .map_err(Error::from),
        }
    }

    pub async fn describe_namespace(
        &mut self,
        request: DescribeNamespaceRequest,
    ) -> Result<tonic::Response<DescribeNamespaceResponse>> {
        match self {
            TemporalClient::Standard(client) => client
                .describe_namespace(request)
                .await
                .map_err(Error::from),
            TemporalClient::WithInterceptor(client) => client
                .describe_namespace(request)
                .await
                .map_err(Error::from),
        }
    }
}
