/**
 * Guide Content Model
 *
 * Types for authoring multi-variant guides in MDX.
 * Readers pick their tech stack, content adapts accordingly.
 */
// =============================================================================
// GUIDE
// =============================================================================

export type Guide = {
  title: string;
  description?: string;

  // Guides can be scoped to a Quick, Project, or Initiative, or a combination of these
  scope: "Quick" | "Project" | "Initiative";

  // Tech choices the reader can make (e.g., language, database)
  readerTechnologySelections?: {
    language: "typescript" | "javascript";
    database: "postgresql" | "mysql";
    orm: "drizzle" | "prisma";
    deployment: "local" | "cloud";
    cloudProvider: "aws" | "azure" | "gcp";
    cloudRegion: "us-east-1" | "us-west-1" | "eu-central-1";
    cloudStorage: "s3" | "gcs" | "azure-blob-storage";
    cloudDatabase: "postgresql" | "mysql";
  }[];

  // One or more projects that make up this guide
  projects: {
    title: string;
    description?: string;
    milestones: {
      title: string;
      description?: string;
      targetDate?: Date;
      steps: {
        title: string;
        content: string;
      }[];
    }[];
  };

  //Related templates that the reader can use
  relatedTemplates?: {
    name: string;
    description: string;
    url: string;
  };
}[];

// STEP 2: Content authoring model
// =============================================================================

// =============================================================================
// PROJECT
// =============================================================================

export type Project = {
  title: string;
  description?: string;
  order: number;
  includeWhen?: {
    choice: string;
    is: string | string[];
  };
  milestones: Milestone[];
};

export type Milestone = {
  title: string;
  description?: string;
  includeWhen?: {
    choice: string;
    is: string | string[];
  };
  order: number;
  steps: Step[];
};

// =============================================================================
// STEP
// =============================================================================

export type Step = {
  title: string;

  includeWhen?: {
    choice: string;
    is: string | string[];
  };

  order: number;

  linearIssue: {
    title: string;
    description?: string;
    estimate?: "xs" | "s" | "m" | "l" | "xl" | "xxl";
  };

  agentInstructions?: {
    prompt: string;
    context: {
      files: string[];
      commands: string[];
    };
  };
};
