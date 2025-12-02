/**
 * Guide Content Model - Type Definitions
 *
 * These types define the data structures for technology-variant guides.
 * Supports:
 * - MDX rendering with conditional content
 * - Export to Linear as projects/issues
 * - Export as coding agent prompts
 */

// =============================================================================
// TECHNOLOGY CONTEXT
// =============================================================================

export type TechDimension = string;

export const CommonDimensions = {
  language: "language",
  framework: "framework",
  scope: "scope",
  oltp: "oltp",
  olap: "olap",
  streaming: "streaming",
  deployment: "deployment",
  cloud: "cloud",
  orm: "orm",
  packageManager: "packageManager",
} as const;

export type TechContext = Record<TechDimension, string>;

export type TechPredicate =
  | { dimension: TechDimension; equals: string }
  | { dimension: TechDimension; oneOf: string[] }
  | { and: TechPredicate[] }
  | { or: TechPredicate[] }
  | { not: TechPredicate };

// =============================================================================
// FRONTMATTER CONFIG
// =============================================================================

export type TechSelectorConfig = {
  dimensions: TechSelectorDimension[];
};

export type TechSelectorDimension = {
  dimension: TechDimension;
  label: string;
  options: TechSelectorOption[];
};

export type TechSelectorOption = {
  value: string;
  label: string;
  default?: boolean;
};

export type GuideFrontmatter = {
  title: string;
  description?: string;
  techSelector?: TechSelectorDimension[];
  /** Linear project metadata for export */
  project?: ProjectMeta;
  [key: string]: unknown;
};

// =============================================================================
// PROJECT / TASK METADATA (for Linear export)
// =============================================================================

export type ProjectMeta = {
  /** Linear project name */
  name: string;
  /** Project description */
  description?: string;
  /** Team or area label */
  team?: string;
  /** Priority: 0 (urgent) - 4 (low) */
  priority?: 0 | 1 | 2 | 3 | 4;
  /** Labels to apply to all issues */
  labels?: string[];
};

export type TaskMeta = {
  /** Issue title (defaults to step title) */
  title?: string;
  /** Detailed description for the issue */
  description?: string;
  /** Acceptance criteria as checklist items */
  acceptanceCriteria?: string[];
  /** Story points or t-shirt size */
  estimate?: "xs" | "s" | "m" | "l" | "xl" | number;
  /** Labels for this specific task */
  labels?: string[];
  /** IDs of steps this depends on */
  dependsOn?: string[];
  /** Assignee hint (role or person) */
  assignee?: string;
};

// =============================================================================
// AGENT PROMPT METADATA
// =============================================================================

/**
 * Agent prompt metadata.
 *
 * Most fields are DERIVED from step content:
 * - goal: defaults to step title
 * - files: extracted from code blocks with filenames
 * - commands: extracted from ```bash code blocks
 * - context: extracted from prose paragraphs
 *
 * Only specify fields here to OVERRIDE or ADD to derived values.
 */
export type AgentPromptMeta = {
  /** Override goal (defaults to step title) */
  goal?: string;
  /** Additional files beyond those in code blocks */
  files?: string[];
  /** Additional commands beyond those in code blocks */
  commands?: string[];
  /** Expected outcome description */
  expectedOutcome?: string;
  /** Additional context beyond prose content */
  context?: string;
  /** Don't do these things */
  avoid?: string[];
};

// =============================================================================
// STEP PROPS (extended)
// =============================================================================

export type StepMeta = {
  /** Unique identifier for dependencies */
  id?: string;
  /** Step title */
  title: string;
  /** Task metadata for Linear export */
  task?: TaskMeta;
  /** Agent prompt metadata for coding assistant export */
  agent?: AgentPromptMeta;
  /** Condition for showing this step */
  when?: TechPredicate;
};

// =============================================================================
// BLOCK METADATA (for exportable content blocks)
// =============================================================================

export type CodeBlockMeta = {
  /** Filename to create/modify */
  filename?: string;
  /** Language hint */
  language?: string;
  /** Description of what this code does */
  description?: string;
  /** Is this the complete file or a snippet? */
  complete?: boolean;
};

export type CommandBlockMeta = {
  /** Shell command(s) */
  command: string | string[];
  /** What this command does */
  description?: string;
  /** Working directory hint */
  cwd?: string;
  /** Expected output pattern */
  expectedOutput?: string;
};

// =============================================================================
// DERIVED CONTENT (extracted from markdown)
// =============================================================================

/**
 * Content derived from parsing step markdown.
 * Used to auto-populate agent prompts and Linear issues.
 */
export type DerivedStepContent = {
  /** Prose paragraphs (non-code content) */
  prose: string[];
  /** Code blocks with metadata */
  codeBlocks: {
    language: string;
    content: string;
    filename?: string;
  }[];
  /** Shell commands (from ```bash blocks) */
  commands: string[];
  /** File paths mentioned (from code block filenames or inline `path` refs) */
  files: string[];
  /** Headings within the step */
  headings: string[];
};

// =============================================================================
// EXPORT HELPERS (types for generated output)
// =============================================================================

export type LinearProject = {
  name: string;
  description?: string;
  issues: LinearIssue[];
};

export type LinearIssue = {
  title: string;
  description: string;
  priority?: number;
  estimate?: number;
  labels?: string[];
  /** Markdown body */
  body: string;
};

/**
 * Generated agent prompt.
 * Combines explicit AgentPromptMeta with DerivedStepContent.
 */
export type AgentPrompt = {
  /** One-line goal (from title or override) */
  goal: string;
  /** Full prompt text */
  prompt: string;
  /** Files mentioned (derived + explicit) */
  files: string[];
  /** Commands mentioned (derived + explicit) */
  commands: string[];
  /** Prose context (derived + explicit) */
  context: string;
};
