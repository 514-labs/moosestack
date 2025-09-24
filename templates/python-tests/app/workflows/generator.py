from moose_lib import Task, TaskConfig, Workflow, WorkflowConfig, OlapTable, InsertOptions, Key, TaskContext
from pydantic import BaseModel
from datetime import datetime
from faker import Faker
from app.ingest.models import Foo, Baz
import requests

class FooWorkflow(BaseModel):
    id: Key[str]
    success: bool
    message: str

workflow_table = OlapTable[FooWorkflow]("foo_workflow")

def run_task(ctx: TaskContext[None]) -> None:
    fake = Faker()
    for i in range(1000):
        # Prepare request data
        foo = Foo(
            primary_key=fake.uuid4(),
            timestamp=fake.date_time_between(start_date='-1y', end_date='now').timestamp(),
            baz=fake.random_element(Baz),
            optional_text=fake.text() if fake.boolean() else None
        )
 
        # POST record to Moose Ingest API
        req = requests.post(
            "http://localhost:4000/ingest/Foo",
            data=foo.model_dump_json().encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )

        if req.status_code == 200:
            workflow_table.insert([{"id": "1", "success": True, "message": f"Inserted Foo with primary key: {foo.primary_key}"}])
        else:
            workflow_table.insert([{"id": "1", "success": False, "message": f"Failed to insert Foo with error: {req.status_code}"}])

ingest_task = Task[None, None](
    name="task",
    config=TaskConfig(run=run_task)
)

ingest_workflow = Workflow(
    name="generator",
    config=WorkflowConfig(starting_task=ingest_task, retries=3, timeout="30s") ## add schedule="@every 5s" if you want to run it automatically on a schedule
)
