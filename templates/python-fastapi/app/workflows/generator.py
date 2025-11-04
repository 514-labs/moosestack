# Workflow: Data Generator
# This workflow generates test data for the Foo model and sends it via HTTP and direct stream

from moose_lib import Task, TaskConfig, Workflow, WorkflowConfig, OlapTable, Key, TaskContext
from pydantic import BaseModel
from faker import Faker
from app.db.models import Foo, foo_pipeline
import requests


class FooWorkflow(BaseModel):
    """Workflow status tracking"""
    id: Key[str]
    success: bool
    message: str


workflow_table = OlapTable[FooWorkflow]("foo_workflow")


def run_task(ctx: TaskContext[None]) -> None:
    """Generate test data and send via HTTP and direct stream"""
    fake = Faker()

    for i in range(1000):
        base_ts = fake.date_time_between(start_date='-1y', end_date='now').timestamp()

        # HTTP path payload
        foo_http = Foo(
            primary_key=fake.uuid4(),
            timestamp=base_ts,
            optional_text=fake.text() if fake.boolean() else None,
        )

        # Direct send payload
        foo_send = Foo(
            primary_key=fake.uuid4(),
            timestamp=base_ts,
            optional_text=fake.text() if fake.boolean() else None,
        )

        # HTTP ingest path
        try:
            req = requests.post(
                "http://localhost:4000/ingest/Foo",
                data=foo_http.model_dump_json().encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            if req.status_code == 200:
                workflow_table.insert([{
                    "id": "1",
                    "success": True,
                    "message": f"HTTP inserted: {foo_http.primary_key}"
                }])
            else:
                workflow_table.insert([{
                    "id": "1",
                    "success": False,
                    "message": f"HTTP failed: {req.status_code}"
                }])
        except Exception as e:
            workflow_table.insert([{
                "id": "1",
                "success": False,
                "message": f"HTTP error: {e}"
            }])

        # Direct stream send path
        try:
            foo_pipeline.get_stream().send(foo_send)
            workflow_table.insert([{
                "id": "1",
                "success": True,
                "message": f"SEND inserted: {foo_send.primary_key}"
            }])
        except Exception as e:
            workflow_table.insert([{
                "id": "1",
                "success": False,
                "message": f"SEND error: {e}"
            }])


ingest_task = Task[None, None](
    name="task",
    config=TaskConfig(run=run_task)
)

ingest_workflow = Workflow(
    name="generator",
    config=WorkflowConfig(
        starting_task=ingest_task,
        retries=3,
        timeout="30s",
        # Uncomment if you want to run it automatically on a schedule
        # schedule="@every 5s",
    )
)
