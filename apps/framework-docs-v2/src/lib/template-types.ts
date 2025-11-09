/**
 * Template metadata from template.config.toml
 */
export interface TemplateConfig {
  language: "typescript" | "python";
  description: string;
  visible?: boolean;
  default_sloan_telemetry?: string;
}

/**
 * Enhanced template metadata with inferred information
 */
export interface TemplateMetadata {
  name: string;
  slug: string;
  language: "typescript" | "python";
  description: string;
  visible: boolean;
  category: "starter" | "framework" | "example";
  frameworks: string[];
  features: string[];
  githubUrl: string;
  initCommand: string;
  type: "template";
}

/**
 * Demo app metadata
 */
export interface AppMetadata {
  name: string;
  slug: string;
  description: string;
  githubUrl: string;
  features: string[];
  frameworks: string[];
  language?: "typescript" | "python";
  blogPost?: string;
  type: "app";
}

/**
 * Unified type for templates and apps
 */
export type ItemMetadata = TemplateMetadata | AppMetadata;
