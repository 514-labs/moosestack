import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

// EXAMPLE_APP_ONLY: These prompts assume the seeded TenantKnowledge demo model.
// Replace or remove them when you swap out the example data model, then search
// the repo for EXAMPLE_APP_ONLY to find the downstream demo wiring.
const SUGGESTED_PROMPTS = [
  "Summarize the highest-priority signals in view.",
  "Which knowledge categories changed most recently?",
  "Which headlines show the smallest counts versus the largest spikes?",
];

type SuggestedPromptsProps = {
  prompts?: string[];
  onPromptClick: (prompt: string) => void;
};

export function SuggestedPrompts({
  prompts = SUGGESTED_PROMPTS,
  onPromptClick,
}: SuggestedPromptsProps) {
  return (
    <div className="flex-none border-t border-border/60 px-4 py-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Suggested prompts</div>
      <Suggestions>
        {prompts.map((prompt, index) => (
          <Suggestion
            key={`${prompt}-${index}`}
            className="border-border/70 bg-background/80 text-left text-muted-foreground hover:text-foreground"
            onClick={onPromptClick}
            suggestion={prompt}
          />
        ))}
      </Suggestions>
    </div>
  );
}
