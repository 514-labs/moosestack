from typing import TypedDict, Any, Optional
from dataclasses import dataclass


class WorkflowStepResult(TypedDict):
    step: str
    data: Optional[dict]


@dataclass
class StepExecutionContext:
    step_name: str
    previous_data: Optional[dict] = None
