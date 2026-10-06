import { z } from "zod";

export const sessionSystemPromptParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();

export const sessionSystemPromptSectionSchema = z
  .object({
    name: z.string(),
    source: z.string(),
    cacheHint: z.enum(["stable", "dynamic"]),
    content: z.string(),
  })
  .strict();

export const sessionSystemPromptSnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    sections: z.array(sessionSystemPromptSectionSchema),
  })
  .strict();

export type SessionSystemPromptSection = z.infer<typeof sessionSystemPromptSectionSchema>;
export type SessionSystemPromptSnapshot = z.infer<typeof sessionSystemPromptSnapshotSchema>;
