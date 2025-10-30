# Workflow Orchestration

## Overview
Workflows in Moose enable you to automate sequences of tasks in a maintainable, reliable way. They provide a powerful way to orchestrate complex data processing pipelines, ETL jobs, and scheduled tasks.

## Basic Workflow Setup

```python
from moose_lib import Workflow, Task
from pydantic import BaseModel
from typing import List, Optional

class WorkflowInput(BaseModel):
    user_id: str
    start_date: str
    end_date: str

class WorkflowOutput(BaseModel):
    processed_records: int
    errors: List[str]

# Create a workflow
DataProcessingWorkflow = Workflow[WorkflowInput, WorkflowOutput](
    name="DataProcessingWorkflow",
    tasks=[
        Task(
            name="validateInput",
            handler=lambda input: validate_input(input)
        ),
        Task(
            name="processData",
            handler=lambda input: process_data(input)
        )
    ]
)

async def validate_input(input: WorkflowInput) -> WorkflowInput:
    # Validate input data
    if not input.user_id or not input.start_date or not input.end_date:
        raise ValueError("Missing required input fields")
    return input

async def process_data(input: WorkflowInput) -> WorkflowOutput:
    # Process data
    records = await process_user_data(input)
    return WorkflowOutput(processed_records=len(records), errors=[])
```

## Task Configuration

The `Task` class accepts the following configuration:

```python
from typing import TypedDict, Optional, List, Callable, Any

class TaskConfig(TypedDict):
    name: str                    # Required: Name of the task
    handler: Callable            # Required: Task handler function
    retry: Optional[dict]        # Retry configuration
    timeout: Optional[int]       # Task timeout in seconds
    dependencies: Optional[List[str]]  # Names of tasks this task depends on
```

## Workflow Operations

### Running Workflows
```python
# Run workflow
result = await DataProcessingWorkflow.run(
    WorkflowInput(
        user_id="user_123",
        start_date="2024-03-01",
        end_date="2024-03-20"
    )
)

# Run workflow with options
result = await DataProcessingWorkflow.run(
    WorkflowInput(
        user_id="user_123",
        start_date="2024-03-01",
        end_date="2024-03-20"
    ),
    options={
        "timeout": 3600,        # 1 hour timeout
        "retry_on_failure": True  # Retry on failure
    }
)
```

### Monitoring Workflows
```python
# Get workflow status
status = await DataProcessingWorkflow.get_status()
print("Workflow status:", status)

# Get task status
task_status = await DataProcessingWorkflow.get_task_status("processData")
print("Task status:", task_status)

# Get workflow history
history = await DataProcessingWorkflow.get_history()
print("Workflow history:", history)
```

## Error Handling

```python
try:
    result = await DataProcessingWorkflow.run(input)
    print("Workflow completed:", result)
except WorkflowError as error:
    print("Workflow failed:", error.message)
    print("Failed task:", error.task)
    print("Error details:", error.details)
except Exception as error:
    print("Unexpected error:", error)
```

## Best Practices

1. **Task Design**
   - Keep tasks focused and single-purpose
   - Handle errors gracefully
   - Use appropriate timeouts
   - Implement retry logic

2. **Workflow Design**
   - Plan task dependencies
   - Consider error handling
   - Monitor workflow progress
   - Log important events

3. **Performance**
   - Optimize task execution
   - Use appropriate timeouts
   - Monitor resource usage
   - Handle large datasets

4. **Maintenance**
   - Monitor workflow health
   - Clean up old workflows
   - Update task configurations
   - Back up workflow data

## Example Usage

### Data Processing Workflow
```python
DataProcessingWorkflow = Workflow[WorkflowInput, WorkflowOutput](
    name="DataProcessingWorkflow",
    tasks=[
        Task(
            name="validateInput",
            handler=lambda input: validate_input(input)
        ),
        Task(
            name="fetchData",
            handler=lambda input: fetch_data(input),
            dependencies=["validateInput"]
        ),
        Task(
            name="processData",
            handler=lambda input: process_data(input),
            dependencies=["fetchData"],
            retry={
                "attempts": 3,
                "delay": 60
            }
        ),
        Task(
            name="saveResults",
            handler=lambda input: save_results(input),
            dependencies=["processData"]
        )
    ]
)

async def validate_input(input: WorkflowInput) -> WorkflowInput:
    if not input.user_id or not input.start_date or not input.end_date:
        raise ValueError("Missing required input fields")
    return input

async def fetch_data(input: WorkflowInput) -> dict:
    data = await fetch_user_data(input)
    return {**input.dict(), "data": data}

async def process_data(input: dict) -> dict:
    processed = await process_user_data(input["data"])
    return {**input, "processed": processed}

async def save_results(input: dict) -> WorkflowOutput:
    await save_processed_data(input["processed"])
    return WorkflowOutput(
        processed_records=len(input["processed"]),
        errors=[]
    )
```

### Scheduled Workflow
```python
ScheduledWorkflow = Workflow[None, None](
    name="ScheduledWorkflow",
    schedule={
        "cron": "0 0 * * *",  # Run daily at midnight
        "timezone": "UTC"
    },
    tasks=[
        Task(
            name="cleanup",
            handler=lambda: cleanup_old_data()
        ),
        Task(
            name="backup",
            handler=lambda: backup_data(),
            dependencies=["cleanup"]
        )
    ]
)

async def cleanup_old_data() -> None:
    # Clean up old data
    await cleanup_data()

async def backup_data() -> None:
    # Backup important data
    await backup_important_data()
```

