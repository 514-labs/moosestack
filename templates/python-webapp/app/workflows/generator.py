"""
Workflow to generate and ingest sample Foo data.

This workflow demonstrates:
- Task definition with TaskConfig
- Workflow orchestration with the Workflow class
- Inserting data into OLAP tables
- Making HTTP requests to ingestion endpoints
"""
from moose_lib import Task, TaskConfig, Workflow, WorkflowConfig, OlapTable, Key, TaskContext
from app.db.models import FooModel
from pydantic import BaseModel
from faker import Faker
from datetime import datetime
import requests
import time


# Data model for OLAP Table
class FooWorkflow(BaseModel):
    id: Key[str]
    success: bool
    message: str


# Create OLAP Table
workflow_table = OlapTable[FooWorkflow]("FooWorkflow")


def run_ingest(ctx: TaskContext[None]) -> None:
    """Generate and ingest 1000 sample Foo records."""
    fake = Faker()

    for i in range(1000):
        foo = FooModel(
            primary_key=fake.uuid4(),
            timestamp=fake.date_time_this_year().timestamp(),
            optional_text=fake.text() if fake.boolean() else None,
        )

        try:
            response = requests.post(
                "http://localhost:4000/ingest/Foo",
                json=foo.model_dump(),
                headers={"Content-Type": "application/json"},
            )

            if not response.ok:
                print(f"Failed to ingest record {i}: {response.status_code} {response.text}")
                workflow_table.insert([
                    {"id": "1", "success": False, "message": response.text}
                ])
        except Exception as error:
            error_msg = str(error)
            print(f"Error ingesting record {i}: {error_msg}")
            workflow_table.insert([
                {"id": "1", "success": False, "message": error_msg}
            ])

        # Add a small delay to avoid overwhelming the server
        if i % 100 == 0:
            print(f"Ingested {i} records...")
            workflow_table.insert([
                {"id": "1", "success": True, "message": f"Ingested {i} records"}
            ])
            time.sleep(0.1)


# Create the task
ingest_task = Task[None, None](
    name="ingest",
    config=TaskConfig(run=run_ingest)
)

# Create the workflow
ingest_workflow = Workflow(
    name="generator",
    config=WorkflowConfig(
        starting_task=ingest_task,
        retries=3,
        timeout="30s",
        # schedule="@every 5s",  # Uncomment to run on a schedule
    )
)
