import type { UserContext } from "./types";

export function getAISystemPrompt(userContext?: UserContext): string {
  let prompt = `You are a helpful AI assistant that can help users with various tasks using available tools.

When users ask questions:
1. Use the available tools to help answer their questions
2. Be conversational and explain what you're doing
3. Return clear, concise answers
4. If a tool is available for a task, use it rather than making assumptions
5. Format results appropriately for easy reading

Be helpful, accurate, and transparent about what tools you're using.`;

  if (userContext) {
    const parts: string[] = [];
    if (userContext.name) parts.push(`name: ${userContext.name}`);
    if (userContext.email) parts.push(`email: ${userContext.email}`);
    if (userContext.orgId) parts.push(`organization: ${userContext.orgId}`);

    if (parts.length > 0) {
      prompt += `\n\nThe current user's identity:\n${parts.join("\n")}\n\nYou may address the user by name when appropriate. Never expose raw user IDs or internal identifiers in responses.`;
    }
  }

  return prompt;
}
