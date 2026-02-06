from dataclasses import dataclass
from datetime import timedelta
from moose_lib.dmv2 import get_workflow, Workflow, Task
from temporalio import workflow
from temporalio.common import RetryPolicy
from typing import Any, Dict, List, Optional
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

    async def _execute_activity_with_state(
        self, wf: Workflow, task: Task, input_data: Optional[Dict] = None
    ) -> List[Any]:
        activity_name = f"{wf.name}/{task.name}"
        self._state.current_step = activity_name

        try:
            # Check history limits BEFORE starting the task, so continue_from_task
            # points to a task that hasn't run yet (avoids duplicate execution).
            info = workflow.info()
            if info.is_continue_as_new_suggested():
                log.info(f"ContinueAsNew suggested by Temporal before task {task.name}")
                return await workflow.continue_as_new(
                    args=[
                        WorkflowRequest(
                            workflow_name=wf.name,
                            execution_mode="continue_as_new",
                            continue_from_task=task.name,
                        ),
                        input_data,
                    ]
                )

            # Execute the activity directly — no polling monitor.
            # A running activity does not generate workflow history events, so the
            # history stays small even for long-running (timeout: "never") tasks.
            result = await self._execute_single_activity(wf, task, input_data)

            # Normal task completion
            results = [result]
            self._state.completed_steps.append(activity_name)

            if task.config.on_complete:
                for child_task in task.config.on_complete:
                    child_result = await self._execute_activity_with_state(
                        wf,
                        child_task,
                        result.data if hasattr(result, "data") else result,
                    )
                    results.extend(child_result)

            return results
        except Exception:
            self._state.failed_step = activity_name
            raise

    async def _execute_single_activity(
        self, wf: Workflow, task: Task, input_data: Optional[Dict] = None
    ) -> WorkflowStepResult:
        """Execute a single activity."""
        activity_name = f"{wf.name}/{task.name}"

        timeout = self._parse_task_timeout(task.config.timeout)
        retries = task.config.retries or 3
        # Temporal's maximum_attempts = total attempts (initial + retries)
        # User-facing "retries" = number of retries after initial failure
        max_attempts = retries + 1
        log.info(
            f"<WF> Executing activity {activity_name} with timeout {timeout} and retries {retries}"
        )

        if timeout is None:
            # For "never" timeout, use very large scheduleToCloseTimeout (like TypeScript)
            result = await workflow.execute_activity(
                activity_name,
                ScriptExecutionInput(
                    workflow_name=wf.name,
                    task_name=task.name,
                    input_data=input_data,
                ),
                schedule_to_close_timeout=timedelta(
                    hours=87600
                ),  # 10 years like TypeScript
                retry_policy=RetryPolicy(
                    maximum_attempts=max_attempts,
                ),
            )
        else:
            result = await workflow.execute_activity(
                activity_name,
                ScriptExecutionInput(
                    workflow_name=wf.name,
                    task_name=task.name,
                    input_data=input_data,
                ),
                start_to_close_timeout=timeout,
                retry_policy=RetryPolicy(
                    maximum_attempts=max_attempts,
                ),
            )

        return result

    @workflow.run
    async def run(
        self, request: WorkflowRequest, input_data: Optional[Dict] = None
    ) -> List[WorkflowStepResult]:
        """Execute a workflow by name or continue from a specific task.

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
        current_task_name = (
            request.continue_from_task
            if request.execution_mode == "continue_as_new"
            else None
        )

        log.info(
            f"Starting workflow: {workflow_name} (mode: {request.execution_mode}) with input: {input_data}"
        )
        if current_task_name:
            log.info(f"Continuing from task: {current_task_name}")

        # Process input data
        current_data = {}
        if input_data:
            try:
                current_data = input_data.get("data", input_data)
                current_data = json.loads(
                    json.dumps(current_data), object_hook=moose_json_decode
                )
                log.info(f"Processed input data: {current_data}")
            except Exception as e:
                log.error(f"Failed to decode input data: {e}")
                raise ValueError(f"Invalid input data: {e}")

        # Get workflow
        wf = get_workflow(workflow_name)
        if not wf:
            raise ValueError(f"Workflow '{workflow_name}' not found")

        # Determine which task to start from
        if current_task_name:
            # Continue-as-new: find the specific task to resume from
            current_task = wf.get_task(current_task_name)
            if not current_task:
                raise ValueError(
                    f"Task '{current_task_name}' not found in workflow '{workflow_name}'"
                )
            log.info(f"Continuing workflow: {wf.name} from task: {current_task.name}")
        else:
            # Normal start: use starting task
            current_task = wf.config.starting_task
            log.info(f"Starting workflow: {wf.name} from beginning")

        # Execute workflow
        result = await self._execute_activity_with_state(wf, current_task, current_data)

        return result
