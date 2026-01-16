export interface WorkflowState {
  completedSteps: string[];
  currentStep: string | null;
  failedStep: string | null;
}

export interface WorkflowTaskResult {
  task: string;
  data: any;
}
