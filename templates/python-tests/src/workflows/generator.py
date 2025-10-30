from moose_lib import Task, TaskConfig, Workflow, WorkflowConfig, OlapTable, InsertOptions, Key, TaskContext
from pydantic import BaseModel
from datetime import datetime
from faker import Faker
from src.ingest.models import Foo, Baz, fooModel
import requests

class FooWorkflow(BaseModel):
    id: Key[str]
    success: bool
    message: str

workflow_table = OlapTable[FooWorkflow]("foo_workflow")

def run_task(ctx: TaskContext[None]) -> None:
    fake = Faker()
    # Use three fixed timestamps for E2E tests to add variability
    # while ensuring predictable results for consumption API tests
    timestamps = [
        1739865600000,  # Feb 18, 2025 00:00:00 UTC (day 18 - should NOT appear in day 19 queries)
        1739952000000,  # Feb 19, 2025 00:00:00 UTC (day 19 - the target day for tests)
        1740038400000,  # Feb 20, 2025 00:00:00 UTC (day 20 - should NOT appear in day 19 queries)
    ]

    for i in range(1000):
        # Cycle through the three timestamps to distribute data across days
        # This tests that aggregation and filtering work correctly
        base_ts = timestamps[i % 3]

        # HTTP path payload
        foo_http = Foo(
            primary_key=fake.uuid4(),
            timestamp=base_ts,
            baz=fake.random_element(Baz),
            optional_text=("from_http\n" + fake.text()) if fake.boolean() else None,
        )

        # Direct send payload
        foo_send = Foo(
            primary_key=fake.uuid4(),
            timestamp=base_ts,
            baz=fake.random_element(Baz),
            optional_text=("from_send\n" + fake.text()) if fake.boolean() else None,
        )

        # HTTP ingest path
        try:
            req = requests.post(
                "http://localhost:4000/ingest/Foo",
                data=foo_http.model_dump_json().encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            if req.status_code == 200:
                workflow_table.insert([{"id": "1", "success": True, "message": f"HTTP inserted: {foo_http.primary_key}"}])
            else:
                workflow_table.insert([{"id": "1", "success": False, "message": f"HTTP failed: {req.status_code}"}])
        except Exception as e:
            workflow_table.insert([{"id": "1", "success": False, "message": f"HTTP error: {e}"}])

        # Direct stream send path
        try:
            fooModel.get_stream().send(foo_send)
            workflow_table.insert([{"id": "1", "success": True, "message": f"SEND inserted: {foo_send.primary_key}"}])
        except Exception as e:
            workflow_table.insert([{"id": "1", "success": False, "message": f"SEND error: {e}"}])

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
        # uncomment if you want to run it automatically on a schedule
        # schedule="@every 5s",
    )
)
