"""
Workflow definitions for Moose Data Model v2 (dmv2).

This module provides classes for defining and configuring workflows composed of tasks,
including task dependencies, configurations, and execution functions.
"""

import dataclasses
from typing import Any, Optional, Dict, List, Callable, Union, Awaitable, Generic
from pydantic import BaseModel

from .types import TypedMooseResource, T_none, U_none
from ._registry import _workflows


@dataclasses.dataclass
class TaskContext(Generic[T_none]):
    """Context object passed to task handlers.

    - When a task declares an input model `T`, `input` is of type `T` (not Optional).
    - For no-input tasks (`T` is `None`), `input` is exactly `None`.
    """

    state: Dict[str, Any]
    input: T_none


type TaskRunFunc[T_none, U_none] = Callable[
    [TaskContext[T_none]], Union[U_none, Awaitable[U_none]]
]


@dataclasses.dataclass
class TaskConfig(Generic[T_none, U_none]):
    """Configuration for a Task.

    Attributes:
        run: The handler function that executes the task logic.
             Signature: run(context: TaskContext[T]) -> U
        on_complete: Optional list of tasks to run after this task completes.
        on_cancel: Optional function to call when the task is cancelled.
                  Signature: on_cancel(context: TaskContext[T]) -> None
        timeout: Optional timeout string (e.g. "5m", "1h", "never").
        retries: Optional number of retry attempts.
    """

    run: TaskRunFunc[T_none, U_none]
    on_complete: Optional[list["Task[U_none, Any]"]] = None
    on_cancel: Optional[
        Callable[[TaskContext[T_none]], Union[None, Awaitable[None]]]
    ] = None
    timeout: Optional[str] = None
    retries: Optional[int] = None


class Task(TypedMooseResource, Generic[T_none, U_none]):
    """Represents a task that can be executed as part of a workflow.

    Tasks are the basic unit of work in a workflow, with typed input and output.
    They can be chained together using the on_complete configuration.

    Args:
        name: The name of the task.
        config: Configuration specifying the task's behavior.
        t: The Pydantic model defining the task's input schema
           (passed via `Task[InputModel, OutputModel](...)`).
           OutputModel can be None for tasks that don't return a value.

    Attributes:
        config (TaskConfig[T, U]): The configuration for this task.
        columns (Columns[T]): Helper for accessing input field names safely.
        name (str): The name of the task.
        model_type (type[T]): The Pydantic model associated with this task's input.
    """

    config: TaskConfig[T_none, U_none]

    def __init__(self, name: str, config: TaskConfig[T_none, U_none], **kwargs):
        super().__init__()
        self._set_type(name, self._get_type(kwargs))
        self.config = config

    @classmethod
    def _get_type(cls, keyword_args: dict):
        t = keyword_args.get("t")
        if t is None:
            raise ValueError(
                f"Use `{cls.__name__}[T, U](name='...')` to supply both input and output types"
            )
        if not isinstance(t, tuple) or len(t) != 2:
            raise ValueError(
                f"Use `{cls.__name__}[T, U](name='...')` to supply both input and output types"
            )

        input_type, output_type = t
        if input_type is not None and (
            not isinstance(input_type, type) or not issubclass(input_type, BaseModel)
        ):
            raise ValueError(f"Input type {input_type} is not a Pydantic model or None")
        if output_type is not None and (
            not isinstance(output_type, type) or not issubclass(output_type, BaseModel)
        ):
            raise ValueError(
                f"Output type {output_type} is not a Pydantic model or None"
            )
        return t

    def _set_type(self, name: str, t: tuple[type[T_none], type[U_none]]):
        input_type, output_type = t
        self._t = input_type
        self._u = output_type
        self.name = name


@dataclasses.dataclass
class WorkflowConfig:
    """Configuration for a workflow.

    Attributes:
        starting_task: The first task to execute in the workflow.
        retries: Optional number of retry attempts for the entire workflow.
        timeout: Optional timeout string for the entire workflow.
        schedule: Optional cron-like schedule string for recurring execution.
    """

    starting_task: Task[Any, Any]
    retries: Optional[int] = None
    timeout: Optional[str] = None
    schedule: Optional[str] = None


class Workflow:
    """Represents a workflow composed of one or more tasks.

    Workflows define a sequence of tasks to be executed, with optional
    scheduling, retries, and timeouts at the workflow level.

    Args:
        name: The name of the workflow.
        config: Configuration specifying the workflow's behavior.

    Attributes:
        name (str): The name of the workflow.
        config (WorkflowConfig): The configuration for this workflow.
    """

    def __init__(self, name: str, config: WorkflowConfig):
        self.name = name
        self.config = config
        # Register the workflow in the internal registry
        _workflows[name] = self

    def get_task_names(self) -> list[str]:
        """Get a list of all task names in this workflow.

        Returns:
            list[str]: List of task names in the workflow, including all child tasks
        """

        def collect_task_names(task: Task) -> list[str]:
            names = [task.name]
            if task.config.on_complete:
                for child in task.config.on_complete:
                    names.extend(collect_task_names(child))
            return names

        return collect_task_names(self.config.starting_task)

    def get_task(self, task_name: str) -> Optional[Task]:
        """Find a task in this workflow by name.

        Args:
            task_name: The name of the task to find

        Returns:
            Optional[Task]: The task if found, None otherwise
        """

        def find_task(task: Task) -> Optional[Task]:
            if task.name == task_name:
                return task
            if task.config.on_complete:
                for child in task.config.on_complete:
                    found = find_task(child)
                    if found:
                        return found
            return None

        return find_task(self.config.starting_task)
