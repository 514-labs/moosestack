/// Shared plan-pass pipeline used by both the file watcher and the TypeScript
/// compilation watcher.  Centralises the plan → validate → confirm → execute →
/// persist sequence so bug-fixes only need to land in one place.
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::cli::display::spinner::SpinnerHandle;
use crate::cli::display::{self, with_timing_async, Message, MessageType};
use crate::cli::processing_coordinator::ProcessingCoordinator;
use crate::cli::routines::openapi::openapi;
use crate::cli::settings::Settings;
use crate::framework;
use crate::framework::core::execute::execute_online_change;
use crate::framework::core::infrastructure_map::{ApiChange, InfrastructureMap};
use crate::framework::core::plan_risk::{
    confirm_renames_and_classify, destructive_confirmation_gate, ConfirmationPolicy,
};
use crate::framework::core::prompt_bridge::PromptBridge;
use crate::framework::core::state_storage::StateStorage;
use crate::framework::core::version_bump;
use crate::infrastructure::olap::clickhouse::remote::ClickHouseRemote;
use crate::infrastructure::processes::process_registry::ProcessRegistries;
use crate::metrics::Metrics;
use crate::project::Project;

/// Everything the plan-pass needs that doesn't change between calls.
pub(crate) struct PlanPassContext {
    pub project: Arc<Project>,
    pub state_storage: Arc<Box<dyn StateStorage>>,
    pub route_update_channel: tokio::sync::mpsc::Sender<(InfrastructureMap, ApiChange)>,
    pub webapp_update_channel:
        tokio::sync::mpsc::Sender<crate::framework::core::infrastructure_map::WebAppChange>,
    pub infrastructure_map: &'static RwLock<InfrastructureMap>,
    pub project_registries: Arc<RwLock<ProcessRegistries>>,
    pub metrics: Arc<Metrics>,
    pub settings: Settings,
    pub processing_coordinator: ProcessingCoordinator,
    pub confirmation_policy: ConfirmationPolicy,
    pub prompt_bridge: Option<PromptBridge>,
    pub remote_for_mirrors: Option<ClickHouseRemote>,
    pub dev_baseline: Arc<InfrastructureMap>,
}

/// Run the full plan → validate → confirm → execute → persist pipeline.
///
/// Returns `Ok(true)` when changes were applied, `Ok(false)` when the user
/// declined, and `Err` on any infrastructure / planning error.
///
/// `is_initial` controls whether external-mirror creation runs (only needed on
/// the very first pass after startup).
pub(crate) async fn run_plan_pass(
    ctx: &PlanPassContext,
    spinner_handle: &SpinnerHandle,
    is_initial: bool,
) -> anyhow::Result<bool> {
    let plan_result = with_timing_async("Planning", async {
        framework::core::plan::plan_changes(&**ctx.state_storage, &ctx.project).await
    })
    .await;

    let (current_infra, mut plan_result) = match plan_result {
        Ok(pair) => pair,
        Err(e) => return Err(e.into()),
    };

    with_timing_async("Validation", async {
        framework::core::plan_validator::validate(&ctx.project, &plan_result)
    })
    .await?;

    spinner_handle.pause();
    let mut risk = match confirm_renames_and_classify(
        &mut plan_result.changes,
        &ctx.confirmation_policy,
        ctx.prompt_bridge.as_ref(),
    )
    .await?
    {
        Some(risk) => risk,
        None => return Ok(false),
    };

    let version_bump_decisions = match version_bump::detect_prompt_and_exclude(
        &plan_result.changes.olap_changes,
        &current_infra,
        &ctx.project.clickhouse_config.db_name,
        ctx.confirmation_policy.accept_all,
        &mut risk,
        ctx.prompt_bridge.as_ref(),
    )
    .await?
    {
        Some(d) => d,
        None => return Ok(false),
    };

    if !destructive_confirmation_gate(&risk, &ctx.confirmation_policy, ctx.prompt_bridge.as_ref())
        .await?
    {
        return Ok(false);
    }
    spinner_handle.resume();

    display::show_changes(&plan_result);
    let _processing_guard = ctx.processing_coordinator.begin_processing().await;
    let mut project_registries = ctx.project_registries.write().await;

    let execution_result = with_timing_async("Execution", async {
        execute_online_change(
            &ctx.project,
            &plan_result,
            ctx.route_update_channel.clone(),
            ctx.webapp_update_channel.clone(),
            &mut project_registries,
            ctx.metrics.clone(),
            &ctx.settings,
            &version_bump_decisions,
        )
        .await
    })
    .await;

    match execution_result {
        Ok(_) => {
            let stored_map = plan_result.target_infra_map;

            with_timing_async("Persist State", async {
                ctx.state_storage
                    .store_infrastructure_map(&stored_map)
                    .await
            })
            .await?;

            if ctx.project.features.migrate_with_deltas {
                if let Err(e) = crate::framework::core::pending_migration::write_pending_migration(
                    &ctx.dev_baseline,
                    &stored_map,
                    &ctx.project,
                ) {
                    tracing::warn!("Failed to write pending migration: {}", e);
                }
            }

            with_timing_async("OpenAPI Gen", async {
                openapi(&ctx.project, &stored_map).await
            })
            .await?;

            if is_initial {
                crate::cli::routines::create_external_mirrors(
                    &ctx.project,
                    &stored_map,
                    ctx.remote_for_mirrors.as_ref(),
                )
                .await;
            }

            let mut infra_ptr = ctx.infrastructure_map.write().await;
            *infra_ptr = stored_map;
            Ok(true)
        }
        Err(e) => Err(e.into()),
    }
}

/// Handle the result of a plan pass with standard user-facing messages.
///
/// After `run_plan_pass` returns, call this to display success/skip/error
/// feedback and optionally fire the reload script.
pub(crate) async fn handle_plan_result(project: &Project, result: &anyhow::Result<bool>) {
    match result {
        Ok(true) => {
            project
                .http_server_config
                .run_after_dev_server_reload_script()
                .await;
        }
        Ok(false) => {
            show_message!(MessageType::Info, {
                Message {
                    action: "Skipped".to_string(),
                    details: "Destructive changes declined by user".to_string(),
                }
            });
        }
        Err(e) => {
            show_message!(MessageType::Error, {
                Message {
                    action: "Failed".to_string(),
                    details: format!("Processing infrastructure changes failed:\n{e:?}"),
                }
            });
        }
    }
}
