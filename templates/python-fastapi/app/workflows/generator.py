from moose_lib import Task, TaskConfig, Workflow, WorkflowConfig, OlapTable, InsertOptions, Key, TaskContext
from faker import Faker
from app.db.models import FooTable, FooModel, Baz
import requests


def run_task(ctx: TaskContext[None]) -> None:
    fake = Faker()
    foos = []
    for i in range(1000):
        # Prepare request data
        foo = FooModel(
            primary_key=fake.uuid4(),
            timestamp=fake.date_time_between(start_date='-1y', end_date='now').timestamp(),
            baz=fake.random_element(Baz),
            optional_text=fake.text() if fake.boolean() else None
        )
        foos.append(foo)
    
    FooTable.insert(foos)



ingest_task = Task[None, None](
    name="task",
    config=TaskConfig(run=run_task)
)

ingest_workflow = Workflow(
    name="generator",
    config=WorkflowConfig(starting_task=ingest_task, retries=3, timeout="30s") ## add schedule="@every 5s" if you want to run it automatically on a schedule
)
