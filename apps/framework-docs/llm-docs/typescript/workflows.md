---
title: TypeScript Workflows
description: Build async workflows with Temporal for long-running tasks, scheduled jobs, and distributed processing
priority: 0.80
category: async-processing
language: typescript
---

# Workflow Orchestration

Moose workflows enable developers to automate sequences of tasks in a maintainable, reliable way. A workflow is a series of tasks that execute in order. Each workflow follows these conventions:

- Workflows live in folders inside the `/app/scripts` subdirectory, with the folder name being the workflow name.
- Tasks are scripts with numerical prefixes (e.g., `1.firstTask.ts`).
- Configuration is managed through `config.toml` files.

This workflow abstraction is powered by Temporal under the hood. You can use the Temporal GUI to monitor your workflow runs as they execute, providing extra debugging capabilities.

## Quickstart

To create a new workflow, run the following command:

```bash
npx moose-cli workflow init ExampleWorkflow --tasks firstTask,secondTask
```

## Workflow Structure

A typical workflow looks like this:

```typescript
// app/scripts/ExampleWorkflow/1.firstTask.ts
import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";

interface FirstTaskInput {
  name: string;
}

const firstTask: TaskFunction = async (input: FirstTaskInput) => {
  const name = input.name ?? "world";
  const greeting = `hello, ${name}!`;
  return {
    task: "firstTask",
    data: {
      name: name,
      greeting: greeting,
      counter: 1
    }
  };
};

export default function createTask() {
  return {
    task: firstTask,
  } as TaskDefinition;
}
```

## Writing Workflow Tasks

Tasks are defined as asynchronous functions (of type `TaskFunction`) that perform some operations and return an object with two key properties: `task` and `data`.

The file must export a function that returns a `TaskDefinition` object. This object is used to register the task with the workflow. Inside this `TaskDefinition` object, you must specify the `task`, which is the function you defined above.

## Data Flow Between Tasks

Tasks communicate through their return values. Each task can return a dictionary containing a `data` key. The contents of this `data` key are automatically passed as input parameters to the next task in the workflow.

- Only values inside the `data` object are passed to the next task.
- Supported data types inside `data` include basic types, containers, and JSON-serializable custom classes.

```typescript
// app/scripts/ExampleWorkflow/1.firstTask.ts
import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";

interface FirstTaskInput {
  name: string;
}

const firstTask: TaskFunction = async (input: FirstTaskInput) => {
  const name = input.name ?? "world";
  const greeting = `hello, ${name}!`;
  return {
    task: "firstTask",
    data: {
      name: name,
      greeting: greeting,
      counter: 1
    }
  };
};

export default function createTask() {
  return {
    task: firstTask,
  } as TaskDefinition;
}

// app/scripts/ExampleWorkflow/2.secondTask.ts
import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";

interface SecondTaskInput {
  name: string;
  greeting: string;
  counter: number;
}

const secondTask: TaskFunction = async (input: SecondTaskInput) => {
  const nameLength = input.name.length;
  const expandedGreeting = `${input.greeting} Your name is ${nameLength} characters long`;
  // Example operation: Double the counter value
  const counter = input.counter + 1;
  return {
    task: "secondTask",
    data: {
      name: input.name,
      greeting: expandedGreeting,
      counter: counter,
      nameLength: nameLength
    }
  };
};

export default function createTask() {
  return {
    task: secondTask,
  } as TaskDefinition;
}
```

## Running Workflows

As you develop workflows, you can run them directly using the Moose CLI:

```bash
npx moose-cli workflow run ExampleWorkflow
```

The terminal will print the following:

```txt
Workflow 'ExampleWorkflow' started successfully.
View it in the Temporal dashboard: http://localhost:8080/namespaces/default/workflows/ExampleWorkflow/3a1cc066-33bf-49ce-8671-63ecdcb72f2a/history
```

### Passing Input to Workflows

When you run a workflow, you can pass input to the workflow by using the `--input` flag:

```bash
npx moose-cli workflow run ExampleWorkflow --input '{"name": "John"}'
```

The input is passed to the workflow as a JSON string.

## Debugging Workflows

While the Temporal dashboard is a helpful tool for debugging, you can also leverage the Moose CLI to monitor and debug workflows. This is useful if you want to monitor a workflow without having to leave your terminal.

Use the `moose-cli workflow status` command to monitor a workflow:

```bash
npx moose-cli workflow status ExampleWorkflow
```

This will print high level information about the workflow run:

```txt
Workflow
Workflow Status: ExampleWorkflow
Run ID: 446eab6e-663d-4913-93fe-f79d6109391f
Status: WORKFLOW_EXECUTION_STATUS_COMPLETED ✅
Execution Time: 66s
```

## Error Detection and Handling

Moose provides multiple layers of error protection, both at the workflow and task level:

### Workflow-Level Retries and Timeouts

Moose automatically catches any runtime errors during workflow execution. Errors are logged for debugging, and the orchestrator will retry failed tasks according to the retry count in `config.toml`.

In your workflow's `config.toml` file, you can configure the following options to control workflow behavior, including timeouts and retries:

```toml
name = "ExampleWorkflow"  # Required. The name of the workflow. Matches the workflow folder name.
timeout = "1h"           # Required. Default: 1 hour
retries = 3             # Required. Default: 3 retries
schedule = ""           # Required. Default: Blank
tasks = ["firstTask", "secondTask"]  # Required. The list of tasks to execute. Matches the task file names.
```

### Task-Level Errors and Retries

To configure a task to have its own retry behavior, you can add a `config` object to the task definition, and specify a number of `retries` within that object:

```typescript
import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";

const firstTask: TaskFunction = async () => {
  throw new Error("This is a test error");
  return {
    task: "firstTask",
    data: {}
  };
};

export default function createTask() {
  return {
    task: firstTask,
    config: {
      retries: 3  // This is optional. If you don't explicitly set retries, it will default to 3.
    }
  } as TaskDefinition;
}
```

### Example: Workflow and Task Retry Interplay

When configuring retries, it's important to understand how workflow-level and task-level retries interact. Consider the following scenario:

- **Workflow Retry Policy**: 2 attempts
```toml
retries = 2
```

- **Task Retry Policy**: 3 attempts
```typescript
export default function createTask() {
  return {
    task: firstTask,
    config: {
      retries: 3
    }
  } as TaskDefinition;
}
```

If the execution of the workflow encounters an error, the retry sequence would proceed as follows:

1. **Workflow Attempt 1**
   - **Task Attempt 1**: Task fails
   - **Task Attempt 2**: Task fails
   - **Task Attempt 3**: Task fails
   - Workflow attempt fails after exhausting task retries

2. **Workflow Attempt 2**
   - **Task Attempt 1**: Task fails
   - **Task Attempt 2**: Task fails
   - **Task Attempt 3**: Task fails
   - Workflow attempt fails after exhausting task retries

In this example, the workflow will make a total of 2 attempts, and each task within those attempts will retry up to 3 times before the workflow itself retries.

### Terminating Workflows

To terminate a workflow before it has finished running, use the `workflow terminate` command:

```bash
npx moose-cli workflow terminate
```

You cannot run the same workflow concurrently. Use the `terminate` command to stop the workflow before triggering it again.

## Using Workflows with Ingestion Points

When you need to ingest data from a workflow, you should send it to an ingestion endpoint rather than returning it as workflow output. This ensures proper data ingestion into your Moose infrastructure.

### Example: Workflow with Ingestion

```typescript
import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";

interface DataIngestionTaskInput {
  source: string;
  timestamp: Date;
}

const dataIngestionTask: TaskFunction = async (input: DataIngestionTaskInput) => {
  // Process your data
  const processedData = {
    id: "123",
    source: input.source,
    timestamp: input.timestamp,
    value: Math.random() * 100
  };

  // Send to ingestion endpoint
  const response = await fetch("/ingest/analytics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(processedData)
  });

  if (!response.ok) {
    throw new Error(`Failed to ingest data: ${response.statusText}`);
  }

  // Return minimal data for workflow tracking
  return {
    task: "dataIngestionTask",
    data: {
      success: true,
      timestamp: new Date().toISOString()
    }
  };
};

export default function createTask() {
  return {
    task: dataIngestionTask,
    config: {
      retries: 3
    }
  } as TaskDefinition;
}
```

### Best Practices for Workflow Ingestion

1. **Use Dedicated Ingestion Endpoints**:
   - Create specific ingestion endpoints for your workflow data
   - Follow the naming convention `/ingest/<name>`
   - Ensure proper schema validation at the ingestion point

2. **Error Handling**:
   - Always check the response status from ingestion endpoints
   - Implement retries for transient failures
   - Log ingestion failures for debugging

3. **Data Validation**:
   - Validate data before sending to ingestion endpoints
   - Ensure data matches the expected schema
   - Handle validation errors gracefully

4. **Monitoring**:
   - Track ingestion success rates
   - Monitor latency of ingestion operations
   - Set up alerts for ingestion failures

### Example: Complete Workflow with Multiple Ingestion Points

```typescript
import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";

interface DataProcessingTaskInput {
  source: string;
  timestamp: Date;
}

const processAndIngestTask: TaskFunction = async (input: DataProcessingTaskInput) => {
  // Process data for different ingestion points
  const analyticsData = {
    id: "123",
    source: input.source,
    timestamp: input.timestamp,
    value: Math.random() * 100
  };

  const metricsData = {
    id: "456",
    source: input.source,
    timestamp: input.timestamp,
    metric: "processing_time",
    value: 150
  };

  // Send to multiple ingestion endpoints
  const [analyticsResponse, metricsResponse] = await Promise.all([
    fetch("/ingest/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(analyticsData)
    }),
    fetch("/ingest/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metricsData)
    })
  ]);

  if (!analyticsResponse.ok || !metricsResponse.ok) {
    throw new Error("Failed to ingest data to one or more endpoints");
  }

  return {
    task: "processAndIngestTask",
    data: {
      success: true,
      timestamp: new Date().toISOString()
    }
  };
};

export default function createTask() {
  return {
    task: processAndIngestTask,
    config: {
      retries: 3
    }
  } as TaskDefinition;
} 