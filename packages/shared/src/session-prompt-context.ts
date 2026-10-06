import { z } from "zod";

export const PROMPT_CONTEXT_CATEGORIES = [
  "system_prompt",
  "meta_user_context",
  "skills",
  "tool_prompt",
  "system_tool_schemas",
  "mcp_tool_schemas",
] as const;

export const sessionPromptContextParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();

export const sessionPromptContextEntrySchema = z
  .object({
    category: z.enum(PROMPT_CONTEXT_CATEGORIES),
    name: z.string(),
    source: z.string(),
    content: z.string(),
  })
  .strict();

export const sessionPromptContextSnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    entries: z.array(sessionPromptContextEntrySchema),
  })
  .strict();

export type PromptContextCategory = (typeof PROMPT_CONTEXT_CATEGORIES)[number];
export type SessionPromptContextEntry = z.infer<typeof sessionPromptContextEntrySchema>;
export type SessionPromptContextSnapshot = z.infer<typeof sessionPromptContextSnapshotSchema>;
