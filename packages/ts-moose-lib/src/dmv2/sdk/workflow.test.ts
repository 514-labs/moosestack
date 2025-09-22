import { expect } from "chai";
import { getMooseInternal, toInfraMap } from "../internal";
import { Task, Workflow, TaskConfig } from "./workflow";

interface UserData {
  id: string;
  name: string;
  email: string;
}

interface ProcessedData {
  userId: string;
  fullName: string;
  domain: string;
}

interface ReportData {
  total: number;
  processed: number;
  failed: number;
}

describe("Workflows & Tasks", () => {
  beforeEach(() => {
    getMooseInternal().workflows.clear();
  });

  describe("Task", () => {
    describe("Task Creation", () => {
      it("should create a task with no input and no output", async () => {
        const taskConfig: TaskConfig<null, void> = {
          run: async ({}) => {
            console.log("Task with no input/output executed");
          },
        };

        const task = new Task<null, void>("noInputNoOutput", taskConfig);

        expect(task.name).to.equal("noInputNoOutput");
        expect(task.config).to.deep.equal(taskConfig);
        expect(task.config.run).to.be.a("function");
      });

      it("should create a task with no input but with output", async () => {
        const taskConfig: TaskConfig<null, ReportData> = {
          run: async ({}) => {
            return {
              total: 100,
              processed: 95,
              failed: 5,
            };
          },
        };

        const task = new Task<null, ReportData>(
          "noInputWithOutput",
          taskConfig,
        );

        expect(task.name).to.equal("noInputWithOutput");
        expect(task.config).to.deep.equal(taskConfig);
      });

      it("should create a task with input but no output", async () => {
        const taskConfig: TaskConfig<UserData, void> = {
          run: async ({ input }) => {
            console.log(`Processing user: ${input.name}`);
          },
        };

        const task = new Task<UserData, void>("inputNoOutput", taskConfig);

        expect(task.name).to.equal("inputNoOutput");
        expect(task.config).to.deep.equal(taskConfig);
      });

      it("should create a task with both input and output", async () => {
        const taskConfig: TaskConfig<UserData, ProcessedData> = {
          run: async ({ input }) => {
            const domain = input.email.split("@")[1];
            return {
              userId: input.id,
              fullName: input.name,
              domain: domain,
            };
          },
        };

        const task = new Task<UserData, ProcessedData>(
          "inputWithOutput",
          taskConfig,
        );

        expect(task.name).to.equal("inputWithOutput");
        expect(task.config).to.deep.equal(taskConfig);
      });
    });

    describe("Task Configuration", () => {
      it("should handle task configuration with timeout and retries", () => {
        const taskConfig: TaskConfig<UserData, ProcessedData> = {
          run: async ({ input }) => {
            return {
              userId: input.id,
              fullName: input.name,
              domain: input.email.split("@")[1],
            };
          },
          timeout: "30s",
          retries: 3,
        };

        const task = new Task<UserData, ProcessedData>(
          "configuredTask",
          taskConfig,
        );

        expect(task.config.timeout).to.equal("30s");
        expect(task.config.retries).to.equal(3);
      });

      it("should handle task configuration with onComplete tasks", () => {
        const firstTask = new Task<null, UserData>("firstTask", {
          run: async ({}) => ({
            id: "1",
            name: "Test User",
            email: "test@example.com",
          }),
        });

        const secondTask = new Task<UserData, ProcessedData>("secondTask", {
          run: async ({ input }) => ({
            userId: input.id,
            fullName: input.name,
            domain: input.email.split("@")[1],
          }),
        });

        const thirdTask = new Task<ProcessedData, void>("thirdTask", {
          run: async ({ input }) => {},
        });

        const fourthTask = new Task<null, void>("fourthTask", {
          run: async ({}) => {},
        });

        // Verifies onComplete can take different permutations of Task input & output types
        firstTask.config.onComplete = [secondTask];
        secondTask.config.onComplete = [thirdTask];
        thirdTask.config.onComplete = [fourthTask];
      });

      it("should handle task with multiple onComplete tasks", () => {
        const mainTask = new Task<null, UserData>("mainTask", {
          run: async ({}) => ({
            id: "1",
            name: "Test User",
            email: "test@example.com",
          }),
        });

        const task1 = new Task<UserData, void>("task1", {
          run: async ({ input }) => {
            console.log(`Task 1 processing ${input.name}`);
          },
        });

        const task2 = new Task<UserData, void>("task2", {
          run: async ({ input }) => {
            console.log(`Task 2 processing ${input.name}`);
          },
        });

        mainTask.config.onComplete = [task1, task2];
      });
    });
  });

  describe("Workflow", () => {
    describe("Workflow Creation", () => {
      it("should support different starting task types", () => {
        const task1 = new Task<null, UserData>("task1", {
          run: async ({}) => ({
            id: "1",
            name: "Test",
            email: "test@example.com",
          }),
        });

        const workflow1 = new Workflow("workflow1", {
          startingTask: task1,
        });
        expect(workflow1.config.startingTask).to.equal(task1);

        const task2 = new Task<null, void>("task2", {
          run: async ({}) => {
            console.log("Void task");
          },
        });

        const workflow2 = new Workflow("workflow2", {
          startingTask: task2,
        });
        expect(workflow2.config.startingTask).to.equal(task2);

        const task3 = new Task<UserData, ProcessedData>("task3", {
          run: async ({ input }) => ({
            userId: input.id,
            fullName: input.name,
            domain: input.email.split("@")[1],
          }),
        });

        const workflow3 = new Workflow("workflow3", {
          startingTask: task3,
        });
        expect(workflow3.config.startingTask).to.equal(task3);

        const task4 = new Task<UserData, void>("task4", {
          run: async ({ input }) => {
            console.log(`Processing ${input.name}`);
          },
        });

        const workflow4 = new Workflow("workflow4", {
          startingTask: task4,
        });
        expect(workflow4.config.startingTask).to.equal(task4);
      });
    });

    describe("Workflow Registration", () => {
      it("should register workflows in moose internal upon creation", () => {
        const startingTask = new Task<null, void>("registrationTask", {
          run: async ({}) => {
            console.log("Registration test task");
          },
        });

        const workflow = new Workflow("registrationWorkflow", {
          startingTask: startingTask,
        });

        const mooseInternal = getMooseInternal();
        expect(mooseInternal.workflows.has("registrationWorkflow")).to.be.true;
        expect(mooseInternal.workflows.get("registrationWorkflow")).to.equal(
          workflow,
        );
      });

      it("should register multiple workflows without conflicts", () => {
        const task1 = new Task<null, void>("task1", {
          run: async ({}) => console.log("Task 1"),
        });

        const task2 = new Task<null, void>("task2", {
          run: async ({}) => console.log("Task 2"),
        });

        const workflow1 = new Workflow("workflow1", {
          startingTask: task1,
          retries: 1,
          timeout: "1h",
          schedule: "* * * * *",
        });

        const workflow2 = new Workflow("workflow2", {
          startingTask: task2,
          retries: 2,
          timeout: "2h",
          schedule: "@every 30s",
        });

        const mooseInternal = getMooseInternal();
        expect(mooseInternal.workflows.size).to.equal(2);
        expect(mooseInternal.workflows.get("workflow1")).to.equal(workflow1);
        expect(mooseInternal.workflows.get("workflow2")).to.equal(workflow2);

        const infraMap = toInfraMap(mooseInternal);
        expect(infraMap.workflows).to.deep.equal({
          workflow1: {
            name: "workflow1",
            retries: 1,
            timeout: "1h",
            schedule: "* * * * *",
          },
          workflow2: {
            name: "workflow2",
            retries: 2,
            timeout: "2h",
            schedule: "@every 30s",
          },
        });
      });

      it("should throw an error when creating workflows with duplicate names", () => {
        const task1 = new Task<null, void>("task1", {
          run: async ({}) => console.log("Task 1"),
        });

        const task2 = new Task<null, void>("task2", {
          run: async ({}) => console.log("Task 2"),
        });

        const workflow1 = new Workflow("duplicateName", {
          startingTask: task1,
        });

        // Should throw an error when trying to create a workflow with the same name
        expect(() => {
          new Workflow("duplicateName", {
            startingTask: task2,
          });
        }).to.throw("Workflow with name duplicateName already exists");

        const mooseInternal = getMooseInternal();
        expect(mooseInternal.workflows.size).to.equal(1);
        expect(mooseInternal.workflows.get("duplicateName")).to.equal(
          workflow1,
        );
      });
    });

    describe("Workflow Validation", () => {
      it("should throw an error when starting task is null", () => {
        expect(() => {
          new Workflow("nullStartingTask", {
            startingTask: null as any,
          });
        }).to.throw(
          'Workflow "nullStartingTask" has a null or undefined starting task',
        );
      });

      it("should throw an error when starting task is undefined", () => {
        expect(() => {
          new Workflow("undefinedStartingTask", {
            startingTask: undefined as any,
          });
        }).to.throw(
          'Workflow "undefinedStartingTask" has a null or undefined starting task',
        );
      });

      it("should throw an error when a task in the chain is null", () => {
        const startingTask = new Task<null, void>("startingTask", {
          run: async ({}) => console.log("Starting task"),
          onComplete: [null as any],
        });

        expect(() => {
          new Workflow("nullTaskInChain", {
            startingTask: startingTask,
          });
        }).to.throw(
          'Workflow "nullTaskInChain" contains a null or undefined task in the task chain: startingTask -> null',
        );
      });

      it("should detect simple infinite loops", () => {
        let infiniteLoopTask1: Task<null, void>;
        let infiniteLoopTask2: Task<null, void>;

        infiniteLoopTask2 = new Task<null, void>("infiniteLoopTask2", {
          run: async ({}) => console.log("infiniteLoopTask2"),
        });

        infiniteLoopTask1 = new Task<null, void>("infiniteLoopTask1", {
          run: async ({}) => console.log("infiniteLoopTask1"),
          onComplete: [infiniteLoopTask2],
        });

        // Create the cycle after both tasks are created
        infiniteLoopTask2.config.onComplete = [infiniteLoopTask1];

        expect(() => {
          new Workflow("infiniteLoopWf", {
            startingTask: infiniteLoopTask1,
          });
        }).to.throw(
          'Workflow "infiniteLoopWf" contains an infinite loop in task chain: infiniteLoopTask1 -> infiniteLoopTask2 -> infiniteLoopTask1',
        );
      });

      it("should detect self-referencing infinite loops", () => {
        let selfReferencingTask: Task<null, void>;

        selfReferencingTask = new Task<null, void>("selfReferencingTask", {
          run: async ({}) => console.log("selfReferencingTask"),
        });

        // Create self-reference
        selfReferencingTask.config.onComplete = [selfReferencingTask];

        expect(() => {
          new Workflow("selfReferenceWf", {
            startingTask: selfReferencingTask,
          });
        }).to.throw(
          'Workflow "selfReferenceWf" contains an infinite loop in task chain: selfReferencingTask',
        );
      });

      it("should detect complex infinite loops", () => {
        let task1: Task<null, void>;
        let task2: Task<null, void>;
        let task3: Task<null, void>;

        task1 = new Task<null, void>("task1", {
          run: async ({}) => console.log("task1"),
        });

        task2 = new Task<null, void>("task2", {
          run: async ({}) => console.log("task2"),
        });

        task3 = new Task<null, void>("task3", {
          run: async ({}) => console.log("task3"),
        });

        // Create a cycle: task1 -> task2 -> task3 -> task1
        task1.config.onComplete = [task2];
        task2.config.onComplete = [task3];
        task3.config.onComplete = [task1];

        expect(() => {
          new Workflow("complexLoopWf", {
            startingTask: task1,
          });
        }).to.throw(
          'Workflow "complexLoopWf" contains an infinite loop in task chain: task1 -> task2 -> task3 -> task1',
        );
      });

      it("should handle workflows with shared tasks (diamond pattern)", () => {
        const startTask = new Task<null, UserData>("startTask", {
          run: async ({}) => ({
            id: "1",
            name: "Test",
            email: "test@example.com",
          }),
        });

        const leftTask = new Task<UserData, ProcessedData>("leftTask", {
          run: async ({ input }) => ({
            userId: input.id,
            fullName: input.name,
            domain: input.email.split("@")[1],
          }),
        });

        const rightTask = new Task<UserData, ProcessedData>("rightTask", {
          run: async ({ input }) => ({
            userId: input.id,
            fullName: input.name.toUpperCase(),
            domain: input.email.split("@")[1],
          }),
        });

        const endTask = new Task<ProcessedData, void>("endTask", {
          run: async ({ input }) => {
            console.log(`Final processing: ${input.fullName}`);
          },
        });

        // Create diamond pattern: start -> [left, right] -> end
        startTask.config.onComplete = [leftTask, rightTask];
        leftTask.config.onComplete = [endTask];
        rightTask.config.onComplete = [endTask];

        // This should not throw any errors (shared tasks are allowed)
        expect(() => {
          new Workflow("diamondWf", {
            startingTask: startTask,
          });
        }).to.not.throw();
      });
    });
  });
});
