import { Workflow, Task } from "./workflow";
import { OlapTable } from "./olapTable";

interface BatchResult<T> {
  items: T[];
  hasMore: boolean;
}

interface TransformedResult<U> {
  items: U[];
}

interface TaskConfig {
  retries: number;
  timeout: string;
}

interface ETLTasks<T, U> {
  extract: Task<null, BatchResult<T>>;
  transform: Task<BatchResult<T>, TransformedResult<U>>;
  load: Task<TransformedResult<U>, void>;
}

class InternalBatcher<T> {
  private iterator: AsyncIterator<T>;
  private batchSize: number;

  constructor(asyncIterable: AsyncIterable<T>, batchSize = 20) {
    this.iterator = asyncIterable[Symbol.asyncIterator]();
    this.batchSize = batchSize;
  }

  async getNextBatch(): Promise<BatchResult<T>> {
    const items: T[] = [];

    for (let i = 0; i < this.batchSize; i++) {
      const { value, done } = await this.iterator.next();

      if (done) {
        return { items, hasMore: false };
      }

      items.push(value);
    }

    return { items, hasMore: true };
  }
}

export interface ETLPipelineConfig<T, U> {
  extract: AsyncIterable<T> | (() => AsyncIterable<T>);
  transform: (sourceData: T) => Promise<U>;
  load: ((data: U[]) => Promise<void>) | OlapTable<U>;
}

export class ETLPipeline<T, U> {
  private batcher!: InternalBatcher<T>;

  constructor(
    readonly name: string,
    readonly config: ETLPipelineConfig<T, U>,
  ) {
    this.setupPipeline();
  }

  private setupPipeline(): void {
    this.batcher = this.createBatcher();
    const tasks = this.createAllTasks();

    tasks.extract.config.onComplete = [tasks.transform];
    tasks.transform.config.onComplete = [tasks.load];

    new Workflow(this.name, {
      startingTask: tasks.extract,
      retries: 1,
      timeout: "30m",
    });
  }

  private createBatcher(): InternalBatcher<T> {
    const iterable =
      typeof this.config.extract === "function" ?
        this.config.extract()
      : this.config.extract;

    return new InternalBatcher(iterable);
  }

  private getDefaultTaskConfig(): TaskConfig {
    return {
      retries: 1,
      timeout: "30m",
    };
  }

  private createAllTasks(): ETLTasks<T, U> {
    const taskConfig = this.getDefaultTaskConfig();

    return {
      extract: this.createExtractTask(taskConfig),
      transform: this.createTransformTask(taskConfig),
      load: this.createLoadTask(taskConfig),
    };
  }

  private createExtractTask(
    taskConfig: TaskConfig,
  ): Task<null, BatchResult<T>> {
    return new Task<null, BatchResult<T>>(`${this.name}_extract`, {
      run: async ({}) => {
        console.log(`Running extract task for ${this.name}...`);
        const batch = await this.batcher.getNextBatch();
        console.log(`Extract task completed with ${batch.items.length} items`);
        return batch;
      },
      retries: taskConfig.retries,
      timeout: taskConfig.timeout,
    });
  }

  private createTransformTask(
    taskConfig: TaskConfig,
  ): Task<BatchResult<T>, TransformedResult<U>> {
    return new Task<BatchResult<T>, TransformedResult<U>>(
      `${this.name}_transform`,
      {
        // Use new single-parameter context API for handlers
        run: async ({ input }) => {
          const batch = input!;
          console.log(
            `Running transform task for ${this.name} with ${batch.items.length} items...`,
          );
          const transformedItems: U[] = [];

          for (const item of batch.items) {
            const transformed = await this.config.transform(item);
            transformedItems.push(transformed);
          }

          console.log(
            `Transform task completed with ${transformedItems.length} items`,
          );
          return { items: transformedItems };
        },
        retries: taskConfig.retries,
        timeout: taskConfig.timeout,
      },
    );
  }

  private createLoadTask(
    taskConfig: TaskConfig,
  ): Task<TransformedResult<U>, void> {
    return new Task<TransformedResult<U>, void>(`${this.name}_load`, {
      run: async ({ input: transformedItems }) => {
        console.log(
          `Running load task for ${this.name} with ${transformedItems.items.length} items...`,
        );

        // Handle both function and OlapTable
        if ("insert" in this.config.load) {
          // It's an OlapTable - insert entire batch
          await this.config.load.insert(transformedItems.items);
        } else {
          // It's a function - call with entire array
          await this.config.load(transformedItems.items);
        }

        console.log(`Load task completed`);
      },
      retries: taskConfig.retries,
      timeout: taskConfig.timeout,
    });
  }

  // Execute the entire ETL pipeline
  async run(): Promise<void> {
    console.log(`Starting ETL Pipeline: ${this.name}`);

    let batchNumber = 1;
    do {
      console.log(`Processing batch ${batchNumber}...`);
      const batch = await this.batcher.getNextBatch();

      if (batch.items.length === 0) {
        break;
      }

      // Transform all items in the batch
      const transformedItems: U[] = [];
      for (const extractedData of batch.items) {
        const transformedData = await this.config.transform(extractedData);
        transformedItems.push(transformedData);
      }

      // Load the entire batch
      if ("insert" in this.config.load) {
        // It's an OlapTable - insert entire batch
        await this.config.load.insert(transformedItems);
      } else {
        // It's a function - call with entire array
        await this.config.load(transformedItems);
      }

      console.log(
        `Completed batch ${batchNumber} with ${batch.items.length} items`,
      );
      batchNumber++;

      if (!batch.hasMore) {
        break;
      }
    } while (true);

    console.log(`Completed ETL Pipeline: ${this.name}`);
  }
}
