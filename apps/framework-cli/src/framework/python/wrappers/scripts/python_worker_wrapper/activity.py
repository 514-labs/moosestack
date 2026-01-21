from temporalio import activity
from dataclasses import dataclass
from moose_lib.dmv2 import get_workflow
from moose_lib.dmv2.workflow import TaskContext
from collections.abc import Callable
from typing import Optional, Any, TextIO
import asyncio
import builtins
import contextvars
from datetime import datetime, timezone
import json
import sys
import traceback
import concurrent.futures

from .logging import log
from .types import WorkflowStepResult
from .serialization import moose_json_decode

# Context variable to track task name without mutating globals
_task_context: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "task_context", default=None
)

# Store original print for restoration
_original_print = builtins.print


# Structured print wrapper that respects kwargs and uses contextvars
def _structured_print(
    *args: Any,
    sep: str = " ",
    end: str = "\n",
    file: Optional[TextIO] = None,
    flush: bool = False,
    **kwargs: Any,
) -> None:
    """Print wrapper that emits structured logs when in a task context."""
    task_name = _task_context.get()

    if task_name and file in (None, sys.stderr, sys.stdout):
        # We're in a task context - emit structured log to stderr
        message = sep.join(str(arg) for arg in args)
        structured_log = json.dumps(
            {
                "__moose_structured_log__": True,
                "level": "info",
                "message": message,
                "task_name": task_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        sys.stderr.write(structured_log + "\n")
        if flush:
            # Flush immediately to ensure logs appear in real-time for debugging.
            # This is intentional despite performance implications, as Temporal
            # task logs are critical for troubleshooting workflow issues.
            sys.stderr.flush()
    else:
        # Not in task context or custom file specified - use original print
        _original_print(*args, sep=sep, end=end, file=file, flush=flush, **kwargs)


# Replace global print with structured wrapper at module load
builtins.print = _structured_print


@dataclass
class ScriptExecutionInput:
    workflow_name: str
    task_name: str
    input_data: Optional[dict] = None


async def _create_heartbeat_task(task_name: str) -> asyncio.Task:
    """Create a heartbeat task for cancellation detection."""

    async def heartbeat_loop():
        while True:
            try:
                activity.heartbeat(f"Task {task_name} in progress")
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                log.info(f"Heartbeat loop cancelled for task {task_name}")
                break

    return asyncio.create_task(heartbeat_loop())


def _process_input_data(execution_input: ScriptExecutionInput) -> dict | None:
    """Extract user input payload. Returns None when not provided."""
    if not execution_input.input_data:
        return None
    return execution_input.input_data.get("data", execution_input.input_data)


def _get_workflow_and_task(execution_input: ScriptExecutionInput):
    """Get workflow and task objects from execution input."""
    log.info(f"Getting workflow {execution_input.workflow_name}")
    workflow = get_workflow(execution_input.workflow_name)
    if not workflow:
        raise ValueError(f"Workflow {execution_input.workflow_name} not found")

    log.info(
        f"Getting task {execution_input.task_name} from workflow {execution_input.workflow_name}"
    )
    task = workflow.get_task(execution_input.task_name)
    if not task:
        raise ValueError(
            f"Task {execution_input.task_name} not found in workflow {execution_input.workflow_name}"
        )

    return workflow, task


def _validate_input_data(input_data: dict | None, task) -> any:
    """Validate input data against task's declared input model.

    - If the task expects no input (model_type is None), return None.
    - If the task expects input but received None, raise a clear error.
    - Otherwise, coerce/validate into the Pydantic model.
    """
    model = getattr(task, "model_type", None)
    if model is None:
        return None

    if input_data is None:
        raise ValueError(
            f"Task '{task.name}' requires input of type {model.__name__} but received None"
        )

    try:
        # If already the correct model instance, return as-is
        if isinstance(input_data, model):
            return input_data
        validated_data = model.model_validate(input_data)
        log.info(f"Converted input data to {model.__name__}: {validated_data}")
        return validated_data
    except Exception as e:
        log.error(f"Failed to validate input data against {model.__name__}: {e}")
        raise ValueError(
            f"Input data does not match task's input type {model.__name__}: {e}"
        )


async def _execute_task_function(
    task: Any,
    input_data: Any,
    executor: concurrent.futures.Executor,
    task_state: dict,
    task_identifier: str,
) -> Any:
    """Execute the task function with a single context parameter.

    Supports both async and sync handlers via a thread executor for sync ones.
    """
    task_func = task.config.run
    context = TaskContext(state=task_state, input=input_data)

    # Set context for structured logging via contextvars
    _task_context.set(task_identifier)

    try:
        if asyncio.iscoroutinefunction(task_func):
            return await task_func(context)
        else:
            loop = asyncio.get_running_loop()
            # Copy context to propagate to thread executor
            ctx = contextvars.copy_context()
            future = loop.run_in_executor(executor, lambda: ctx.run(task_func, context))
            return await asyncio.wait_for(future, timeout=None)
    finally:
        # Clear context
        _task_context.set(None)


async def _handle_task_cancellation(task, task_name: str, task_state: dict, input_data):
    """Handle task cancellation and call onCancel handler if it exists."""
    log.info(f"Task {task_name} cancelled, calling onCancel handler if it exists")

    if task.config.on_cancel:
        try:
            context = TaskContext(state=task_state, input=input_data)
            if asyncio.iscoroutinefunction(task.config.on_cancel):
                await task.config.on_cancel(context)
            else:
                task.config.on_cancel(context)
            log.info(f"onCancel handler completed for task {task_name}")
        except Exception as cancel_error:
            log.error(f"Error in onCancel handler for task {task_name}: {cancel_error}")
            # Don't re-raise onCancel errors, just log them


async def _cleanup_resources(heartbeat_task: asyncio.Task, executor):
    """Clean up heartbeat task and executor."""
    heartbeat_task.cancel()
    try:
        await heartbeat_task
    except asyncio.CancelledError:
        pass  # Expected when we cancel the heartbeat task
    executor.shutdown(wait=False)


def create_activity_for_script(script_name: str) -> Callable:
    """Return a new Activity function whose ActivityType = script_name."""

    @activity.defn(name=script_name)
    async def dynamic_activity(
        execution_input: ScriptExecutionInput,
    ) -> WorkflowStepResult:
        """Execute a task with cancellation support."""
        return await _execute_task(execution_input, script_name)

    return dynamic_activity


async def _execute_task(
    execution_input: ScriptExecutionInput, script_name: str
) -> WorkflowStepResult:
    """Main task execution logic separated for better testability and readability."""
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    heartbeat_task = await _create_heartbeat_task(execution_input.task_name)

    # Shared task state that can be accessed by both run and onCancel
    shared_task_state = {}

    try:
        log.info(f"Executing task {script_name} with input {execution_input}")

        # Process and validate input
        input_data = _process_input_data(execution_input)
        log.info(f"Processed input_data for task: {input_data}")

        # Get workflow and task objects
        workflow, task = _get_workflow_and_task(execution_input)
        log.info(
            f"Found task {execution_input.task_name} in workflow {execution_input.workflow_name}"
        )

        # Validate input data against task's input type
        validated_input = _validate_input_data(input_data, task)

        # Send initial heartbeat
        activity.heartbeat(f"Starting task: {execution_input.task_name}")

        try:
            # Create task identifier for logging
            task_identifier = (
                f"{execution_input.workflow_name}/{execution_input.task_name}"
            )

            # Execute the task function
            result = await _execute_task_function(
                task, validated_input, executor, shared_task_state, task_identifier
            )

            # Return structured result
            return WorkflowStepResult(task=execution_input.task_name, data=result)
        except asyncio.CancelledError:
            # Handle cancellation and call onCancel handler with shared task state
            await _handle_task_cancellation(
                task, execution_input.task_name, shared_task_state, validated_input
            )
            raise  # Re-raise to signal cancellation to Temporal

    except Exception as e:
        if not isinstance(e, asyncio.CancelledError):
            # Handle non-cancellation errors
            error_data = {
                "error": "Task execution failed",
                "details": str(e),
                "traceback": traceback.format_exc(),
            }
            log.error(json.dumps(error_data))
            from temporalio.exceptions import ApplicationError

            raise ApplicationError(json.dumps(error_data))
        else:
            raise  # Re-raise CancelledError
    finally:
        # Clean up resources
        await _cleanup_resources(heartbeat_task, executor)
