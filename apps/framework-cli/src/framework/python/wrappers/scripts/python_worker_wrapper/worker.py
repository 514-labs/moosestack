from temporalio.client import Client
from temporalio.worker import Worker
import os
from typing import List, Optional
from .workflow import ScriptWorkflow
from .activity import create_activity_for_script
from .logging import log
import asyncio
import signal
from .utils.temporal import create_temporal_connection
from moose_lib.dmv2 import get_workflows, Workflow
from moose_lib.internal import load_models

# Maintain a global set of activity names we've already created
_ALREADY_REGISTERED = set()

def collect_activities_dmv2(workflows: dict[str, Workflow]) -> List[str]:
    """Collect all task names from DMv2 workflows, formatted as 'workflowName/taskName'.

    Args:
        workflows: Dictionary of workflow name to Workflow instance

    Returns:
        List[str]: List of activity names in format 'workflowName/taskName'
    """
    log.info(f"<DMV2WF> Collecting tasks from dmv2 workflows")
    script_names = []
    for name, workflow in workflows.items():
        log.info(f"<DMV2WF> Registering dmv2 workflow: {name}")
        # Get all task names and format them with the workflow name
        task_names = workflow.get_task_names()
        script_names.extend(f"{name}/{task_name}" for task_name in task_names)
        log.info(f"<DMV2WF> Found tasks for workflow {name}: {task_names}")

    return script_names

def load_dmv2_workflows() -> dict[str, Workflow]:
    """Load DMV2 workflows, returning an empty dict if there's an error.

    Returns:
        dict[str, Workflow]: Map of workflow names to Workflow objects, empty if loading fails.
    """
    try:
        load_models()
        return get_workflows()
    except Exception as e:
        log.error(f"Failed to load DMV2 workflows: {e}")
        return {}

async def register_workflows(temporal_url: str, namespace: str, client_cert: str, client_key: str, api_key: str) -> Optional[Worker]:
    """
    Register DMv2 workflows and their activities.
    """
    log.info(f"Registering DMv2 workflows")

    try:
        # Load DMv2 workflows
        dmv2wfs = load_dmv2_workflows()
        if len(dmv2wfs) == 0:
            log.warning(f"No DMv2 workflows found")
            return None

        log.info(f"Found {len(dmv2wfs)} DMv2 workflows")

        # Collect activities from DMv2 workflows
        all_activity_names = collect_activities_dmv2(dmv2wfs)
        log.info(f"Activity names: {all_activity_names}")

        if len(all_activity_names) == 0:
            log.warning(f"No tasks found in DMv2 workflows")
            return None

        # Build dynamic activities for DMv2 tasks
        dynamic_activities = []
        for activity_name in all_activity_names:
            if activity_name not in _ALREADY_REGISTERED:
                act = create_activity_for_script(activity_name)
                dynamic_activities.append(act)
                _ALREADY_REGISTERED.add(activity_name)
                log.info(f"Registered DMv2 task {activity_name}")

        if len(dynamic_activities) == 0:
            log.warning(f"No dynamic activities created")
            return None

        log.info(f"Created {len(dynamic_activities)} dynamic activities")

        log.info("Connecting to Temporal server...")
        client = await create_temporal_connection(temporal_url, namespace, client_cert, client_key, api_key)
        
        log.info("Creating worker...")
        worker = Worker(
            client,
            task_queue="python-script-queue",
            workflows=[ScriptWorkflow],
            activities=dynamic_activities,
        )
        log.info("Worker created successfully")
        return worker
        
    except Exception as e:
        log.error(f"Error registering workflows: {str(e)}")
        raise

async def start_worker(temporal_url: str, namespace: str, client_cert: str, client_key: str, api_key: str) -> Worker:
    """
    Start a Temporal worker that handles Python script execution workflows.

    Returns:
        Worker: The started Temporal worker instance.
    """
    log.info(f"Starting Python worker")

    loop = asyncio.get_running_loop()

    worker = await register_workflows(temporal_url, namespace, client_cert, client_key, api_key)

    if worker is None:
        log.info("No worker found to start")
        return

    shutdown_task = None

    # Define shutdown coroutine
    async def shutdown():
        log.info("Initiating graceful shutdown...")
        try:
            await asyncio.wait_for(worker.shutdown(), timeout=5.0)
        except asyncio.TimeoutError:
            log.warning("Worker shutdown timed out after 5 seconds")
        except Exception as e:
            log.error(f"Error during worker shutdown: {e}")

    # Define your signal handler
    def handle_signal(signame):
        nonlocal shutdown_task
        if shutdown_task is None:  # Prevent multiple shutdown tasks
            log.info(f"Received signal {signame}, initiating shutdown...")
            shutdown_task = asyncio.create_task(shutdown())

    # Add signal handlers
    for signame in ('SIGTERM', 'SIGQUIT', 'SIGHUP'):
        loop.add_signal_handler(getattr(signal, signame), lambda s=signame: handle_signal(s))
    
    log.info("Starting Python worker...")
    try:
        worker_task = asyncio.create_task(worker.run())
        
        # Loop and check for shutdown
        while True:
            if shutdown_task is not None:
                # Wait for shutdown to complete
                try:
                    await asyncio.wait_for(shutdown_task, timeout=10.0)
                except asyncio.TimeoutError:
                    log.error("Shutdown timed out")
                break
            await asyncio.sleep(0.1)  # Small sleep to prevent busy loop

    except Exception as e:
        log.error(f"Worker failed to start: {e}")
        raise
    finally:
        # Cancel any remaining tasks
        if shutdown_task is not None and not shutdown_task.done():
            shutdown_task.cancel()
        if not worker_task.done():
            worker_task.cancel()
            try:
                await asyncio.wait_for(worker_task, timeout=5.0)
            except asyncio.TimeoutError:
                log.warning("Worker task did not complete after cancellation")
    
    return worker