import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

const SUGGESTED_PROMPTS = [
  "Summarize the highest-priority signals for this tenant.",
  "Use the multi-agent flow to inspect the data catalog, route to the right specialist, then summarize the result.",
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
