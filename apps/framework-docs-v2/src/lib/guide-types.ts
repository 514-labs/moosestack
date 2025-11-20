import { z } from "zod";

export const GuideOptionValueSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const GuideOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["select", "radio"]), // Can expand to other types if needed
  values: z.array(GuideOptionValueSchema),
  defaultValue: z.string().optional(),
});

export const GuideFlowSchema = z.object({
  stepsDir: z.string(),
  title: z.string(),
});

export const GuideManifestSchema = z.object({
  id: z.string(),
  title: z.string(),
  options: z.array(GuideOptionSchema),
  flows: z.record(GuideFlowSchema),
});

export type GuideOptionValue = z.infer<typeof GuideOptionValueSchema>;
export type GuideOption = z.infer<typeof GuideOptionSchema>;
export type GuideFlow = z.infer<typeof GuideFlowSchema>;
export type GuideManifest = z.infer<typeof GuideManifestSchema>;

export interface GuideStep {
  stepNumber: number;
  title: string;
  slug: string;
  content: string | null; // null if loading fails or not MDX
  isMDX: boolean;
}
