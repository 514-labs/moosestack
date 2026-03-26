import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

const SUGGESTED_PROMPTS = [
  "Summarize the highest-priority signals for this tenant.",
  "Inspect the data catalog, then query tenant knowledge by category.",
  "Which knowledge categories changed most recently for this tenant?",
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
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Suggested prompts
      </div>
      <Suggestions>
        {prompts.map((prompt) => (
          <Suggestion
            key={prompt}
            className="border-border/70 bg-background/80 text-left text-muted-foreground hover:text-foreground"
            onClick={onPromptClick}
            suggestion={prompt}
          />
        ))}
      </Suggestions>
    </div>
  );
}
