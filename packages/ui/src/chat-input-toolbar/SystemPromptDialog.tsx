import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useSessionSystemPrompt } from "@/hooks/useSessionSystemPrompt.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";
import {
  TID_CHAT_SYSTEM_PROMPT_COPY,
  TID_CHAT_SYSTEM_PROMPT_DIALOG,
  TID_CHAT_SYSTEM_PROMPT_SECTION,
} from "@nex/shared";

export function SystemPromptDialog({
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
  const state = useSessionSystemPrompt({
    workspacePath,
    workspaceIdentity,
    sessionId,
    enabled: open,
  });
  const sections = state.status === "ready" ? state.sections : [];

  const copyAll = () => {
    const text = sections.map((section) => `# ${section.name}\n\n${section.content}`).join("\n\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {state.status === "loading" ? (
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "chat.systemPrompt.loading" })}
            </p>
          ) : null}
          {state.status === "error" ? (
            <p className="text-ui-sm text-destructive">
              {intl.formatMessage({ id: "chat.systemPrompt.unavailable" })}
            </p>
          ) : null}
          {state.status === "ready" && sections.length === 0 ? (
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "chat.systemPrompt.empty" })}
            </p>
          ) : null}
          {sections.map((section, index) => (
            <section
              key={`${section.source}-${index}`}
              data-testid={TID_CHAT_SYSTEM_PROMPT_SECTION}
            >
              <h3 className="mb-1 text-ui-sm font-medium text-foreground">{section.name}</h3>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 font-mono text-ui-sm text-foreground select-text">
                {section.content}
              </pre>
            </section>
          ))}
        </div>
        {sections.length > 0 ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyAll}
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
