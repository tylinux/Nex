import { useState } from "react";
import {
  PROMPT_CONTEXT_CATEGORIES,
  TID_CHAT_SYSTEM_PROMPT_COPY,
  TID_CHAT_SYSTEM_PROMPT_DIALOG,
  TID_CHAT_SYSTEM_PROMPT_SECTION,
  TID_CHAT_SYSTEM_PROMPT_TAB,
  type PromptContextCategory,
} from "@nex/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useSessionPromptContext } from "@/hooks/useSessionPromptContext.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";

// 与 context 面板 breakdown 行共用同一组文案，标签和百分比行一一对应。
const CATEGORY_LABEL_ID: Record<PromptContextCategory, string> = {
  system_prompt: "chat.contextUsage.breakdown.systemPrompt",
  meta_user_context: "chat.contextUsage.breakdown.metaUserContext",
  skills: "chat.contextUsage.breakdown.skills",
  tool_prompt: "chat.contextUsage.breakdown.toolPrompt",
  system_tool_schemas: "chat.contextUsage.breakdown.systemTools",
  mcp_tool_schemas: "chat.contextUsage.breakdown.mcpTools",
};

export function PromptContextDialog({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
}) {
  const { intl } = useNexIntl();
  const [copied, setCopied] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<PromptContextCategory | null>(null);
  const state = useSessionPromptContext({
    workspacePath,
    workspaceIdentity,
    sessionId,
    enabled: open,
  });
  const entries = state.status === "ready" ? state.entries : [];
  const categories = PROMPT_CONTEXT_CATEGORIES.filter((category) =>
    entries.some((entry) => entry.category === category),
  );
  const activeCategory =
    selectedCategory && categories.includes(selectedCategory) ? selectedCategory : categories[0];

  const copyActive = () => {
    const text = entries
      .filter((entry) => entry.category === activeCategory)
      .map((entry) => `# ${entry.name}\n\n${entry.content}`)
      .join("\n\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const message = (id: string) => (
    <p
      className={
        id.endsWith("unavailable")
          ? "text-ui-sm text-destructive"
          : "text-ui-sm text-foreground-subtle"
      }
    >
      {intl.formatMessage({ id })}
    </p>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] max-w-3xl flex-col"
        data-testid={TID_CHAT_SYSTEM_PROMPT_DIALOG}
      >
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "chat.systemPrompt.title" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "chat.systemPrompt.description" })}
          </DialogDescription>
        </DialogHeader>
        {state.status === "loading" ? message("chat.systemPrompt.loading") : null}
        {state.status === "error" ? message("chat.systemPrompt.unavailable") : null}
        {state.status === "ready" && categories.length === 0
          ? message("chat.systemPrompt.empty")
          : null}
        {activeCategory ? (
          <Tabs
            value={activeCategory}
            onValueChange={(value) => setSelectedCategory(value as PromptContextCategory)}
            className="min-h-0 flex-1 gap-3"
          >
            <TabsList className="h-auto max-w-full flex-wrap justify-start">
              {categories.map((category) => (
                <TabsTrigger
                  key={category}
                  value={category}
                  className="flex-none px-2.5"
                  data-testid={`${TID_CHAT_SYSTEM_PROMPT_TAB}-${category}`}
                >
                  {intl.formatMessage({ id: CATEGORY_LABEL_ID[category] })}
                </TabsTrigger>
              ))}
            </TabsList>
            {categories.map((category) => (
              <TabsContent
                key={category}
                value={category}
                className="min-h-0 space-y-4 overflow-y-auto"
              >
                {entries
                  .filter((entry) => entry.category === category)
                  .map((entry, index) => (
                    <section
                      key={`${entry.source}-${entry.name}-${index}`}
                      data-testid={TID_CHAT_SYSTEM_PROMPT_SECTION}
                    >
                      <h3 className="mb-1 text-ui-sm font-medium text-foreground">{entry.name}</h3>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 font-mono text-ui-sm text-foreground select-text">
                        {entry.content}
                      </pre>
                    </section>
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
        {activeCategory ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyActive}
              data-testid={TID_CHAT_SYSTEM_PROMPT_COPY}
            >
              {intl.formatMessage({
                id: copied ? "chat.systemPrompt.copied" : "chat.systemPrompt.copy",
              })}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
