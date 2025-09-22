from dataclasses import dataclass
from datetime import timedelta
from moose_lib.dmv2 import get_workflow, Workflow, Task
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Any, Dict, List, Optional, Union
import asyncio
from .activity import ScriptExecutionInput
from .logging import log
from .types import WorkflowStepResult
from .serialization import moose_json_decode
import json
import humanfriendly

# TODO: make this configurable
START_TO_CLOSE_TIMEOUT_MINUTES = 60 

@dataclass
class WorkflowState:
    """Represents the current state of a script workflow execution.
    
    Attributes:
        completed_steps: List of activity names that have completed successfully
        current_step: Name of the activity currently being executed, if any
        failed_step: Name of the activity that failed, if any
        script_path: Path to the script file being executed
        input_data: Optional input data passed to the script
    """
    completed_steps: List[str]
    current_step: Optional[str]
    failed_step: Optional[str]
    script_path: Optional[str]
    input_data: Optional[Dict]

@dataclass
class WorkflowRequest:
    """Clean workflow request structure."""
    workflow_name: str
    execution_mode: str  # 'start' or 'continue_as_new'
    continue_from_task: Optional[str] = None  # Only for continue_as_new

@dataclass
class ContinueAsNewData:
    """Data structure for continue-as-new functionality."""
    current_workflow: str
    current_task: str  # Task name to resume from

@workflow.defn(sandboxed=False)
class ScriptWorkflow:
    """A Temporal workflow that executes Python scripts as activities.
    
    This workflow can:
    - Execute a single Python script
    - Execute multiple scripts in sequence from a directory
    - Execute scripts in parallel from specially named directories
    - Execute child workflows based on directory structure
    """
    def __init__(self):
        self._state = WorkflowState(
            completed_steps=[],
            current_step=None,
            failed_step=None,
            script_path=Optional[str],
            input_data=None,
        )

    @workflow.signal(name="resume")
    async def resume_execution(self) -> Dict:
        """Signal to resume workflow after a step has been fixed.
        
        Clears the failed step state and continues execution with the same script path
        and input data.
        
        Returns:
            Dict: Result of the continued workflow execution
        """
        self._state.failed_step = None
        script_path = self._state.script_path
        input_data = self._state.input_data

        return await workflow.continue_as_new(args=[script_path, input_data])

    @workflow.query
    def get_workflow_state(self) -> WorkflowState:
        """Query current workflow state.
        
        Returns:
            WorkflowState: Current state of the workflow execution
        """
        return self._state

    def _parse_task_timeout(self, timeout_str: Optional[str]) -> Optional[timedelta]:
        """Parse timeout string, supporting 'never' for unlimited execution."""
        if not timeout_str:
            return timedelta(minutes=START_TO_CLOSE_TIMEOUT_MINUTES)
        elif timeout_str == "never":
            return None  # No timeout = unlimited execution
        else:
            return timedelta(seconds=humanfriendly.parse_timespan(timeout_str))

    async def _monitor_workflow_history(self, workflow_name: str, task: Task, completed_event: asyncio.Event) -> Optional[ContinueAsNewData]:
        """Monitor workflow history and trigger continue-as-new when suggested.

        Exits promptly when the main task completes using a shared completion event.
        """
        log.info(f"Monitor task starting for {task.name}")

        while not completed_event.is_set():
            info = workflow.info()

            # Continue-as-new only when suggested by Temporal
            if info.is_continue_as_new_suggested():
                log.info("Continue-as-new suggested by Temporal")
                return ContinueAsNewData(
                    current_workflow=workflow_name,
                    current_task=task.name,
                )

            # Wait up to 100ms, but exit early if task completes
            try:
                await asyncio.wait_for(completed_event.wait(), timeout=0.1)
            except asyncio.TimeoutError:
                pass

        log.info("Monitor task exiting because main task completed")
        return None

    async def _execute_dmv2_activity_with_state(self, dmv2wf: Workflow, task: Task, input_data: Optional[Dict] = None) -> Union[List[Any], ContinueAsNewData]:
        activity_name = f"{dmv2wf.name}/{task.name}"
        self._state.current_step = activity_name

        completed_event: asyncio.Event = asyncio.Event()
        history_monitor = self._monitor_workflow_history(dmv2wf.name, task, completed_event)

        activity_task: Optional[asyncio.Task] = None
        monitor_task: Optional[asyncio.Task] = None

        try:
            # Create task execution coroutine
            task_execution = self._execute_single_activity(dmv2wf, task, input_data)

            # Race them like TypeScript Promise.race - but don't manually cancel!
            activity_task = asyncio.create_task(task_execution)
            monitor_task = asyncio.create_task(history_monitor)
            done, pending = await asyncio.wait(
                [activity_task, monitor_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Get result from completed task
            completed_task = done.pop()
            # If the activity finished first, signal the monitor to exit
            if activity_task in done:
                completed_event.set()
            result = await completed_task

            # Check if it's continue-as-new
            if isinstance(result, ContinueAsNewData):
                log.info("Workflow continuing as new due to history limits")
                # Just return the continue-as-new data - Temporal will handle cancellation
                return result

            # Normal task completion - handle child tasks
            results = [result]
            self._state.completed_steps.append(activity_name)

            if task.config.on_complete:
                for child_task in task.config.on_complete:
                    child_result = await self._execute_dmv2_activity_with_state(dmv2wf, child_task, result.data if hasattr(result, 'data') else result)
                    if isinstance(child_result, ContinueAsNewData):
                        return child_result  # Propagate continue-as-new
                    results.extend(child_result)

            return results
        except Exception as e:
            self._state.failed_step = activity_name
            raise
        finally:
            # Ensure the monitor exits and tasks are cleaned up
            try:
                completed_event.set()
            except Exception:
                pass
            for t in (activity_task, monitor_task):
                if t is not None and not t.done():
                    t.cancel()
            # Await tasks to avoid warnings; ignore exceptions from cancellations
            await asyncio.gather(
                *(t for t in (activity_task, monitor_task) if t is not None),
                return_exceptions=True,
            )

    async def _execute_single_activity(self, dmv2wf: Workflow, task: Task, input_data: Optional[Dict] = None) -> WorkflowStepResult:
        """Execute a single activity without racing against history monitor."""
        activity_name = f"{dmv2wf.name}/{task.name}"

        timeout = self._parse_task_timeout(task.config.timeout)
        retries = task.config.retries or 3
        log.info(f"<DMV2WF> Executing activity {activity_name} with timeout {timeout} and retries {retries}")

        if timeout is None:
            # For "never" timeout, use very large scheduleToCloseTimeout (like TypeScript)
            result = await workflow.execute_activity(
                activity_name,
                ScriptExecutionInput(dmv2_workflow_name=dmv2wf.name, task_name=task.name, input_data=input_data),
                schedule_to_close_timeout=timedelta(hours=87600),  # 10 years like TypeScript
                retry_policy=RetryPolicy(
                    maximum_attempts=retries,
                ),
            )
        else:
            result = await workflow.execute_activity(
                activity_name,
                ScriptExecutionInput(dmv2_workflow_name=dmv2wf.name, task_name=task.name, input_data=input_data),
                start_to_close_timeout=timeout,
                retry_policy=RetryPolicy(
                    maximum_attempts=retries,
                ),
            )

        return result

    @workflow.run
    async def run(self, request: WorkflowRequest, input_data: Optional[Dict] = None) -> List[WorkflowStepResult]:
        """Execute a DMv2 workflow by name or continue from a specific task.

        Args:
            request: WorkflowRequest with workflow_name, execution_mode, and optional continue_from_task
            input_data: Optional input data for the workflow

        Returns:
            List of workflow step results

        Raises:
            ValueError: If workflow is not found or input data is invalid
        """

        if isinstance(request, dict):
            request = WorkflowRequest(**request)

        workflow_name = request.workflow_name
        current_task_name = request.continue_from_task if request.execution_mode == 'continue_as_new' else None

        log.info(f"Starting DMv2 workflow: {workflow_name} (mode: {request.execution_mode}) with input: {input_data}")
        if current_task_name:
            log.info(f"Continuing from task: {current_task_name}")

        # Process input data
        current_data = {}
        if input_data:
            try:
                current_data = input_data.get("data", input_data)
                current_data = json.loads(
                    json.dumps(current_data),
                    object_hook=moose_json_decode
                )
                log.info(f"Processed input data: {current_data}")
            except Exception as e:
                log.error(f"Failed to decode input data: {e}")
                raise ValueError(f"Invalid input data: {e}")
        
        # Get DMv2 workflow
        dmv2wf = get_workflow(workflow_name)
        if not dmv2wf:
            raise ValueError(f"DMv2 workflow '{workflow_name}' not found")

        # Determine which task to start from
        if current_task_name:
            # Continue-as-new: find the specific task to resume from
            current_task = dmv2wf.get_task(current_task_name)
            if not current_task:
                raise ValueError(f"Task '{current_task_name}' not found in workflow '{workflow_name}'")
            log.info(f"Continuing DMv2 workflow: {dmv2wf.name} from task: {current_task.name}")
        else:
            # Normal start: use starting task
            current_task = dmv2wf.config.starting_task
            log.info(f"Starting DMv2 workflow: {dmv2wf.name} from beginning")

        # Execute workflow
        result = await self._execute_dmv2_activity_with_state(dmv2wf, current_task, current_data)

        # Handle continue-as-new
        if isinstance(result, ContinueAsNewData):
            log.info(f"Triggering continue-as-new for workflow {result.current_workflow} at task {result.current_task}")
            return await workflow.continue_as_new(
                args=[WorkflowRequest(
                    workflow_name=result.current_workflow,
                    execution_mode="continue_as_new",
                    continue_from_task=result.current_task
                ), input_data]
            )

        return result
