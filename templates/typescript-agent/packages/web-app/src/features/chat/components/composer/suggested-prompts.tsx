import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

const SUGGESTED_PROMPTS = [
  "Summarize the highest-priority signals in view.",
  "Which knowledge categories changed most recently?",
  "Compare the newest operational updates with the fleet health changes.",
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
