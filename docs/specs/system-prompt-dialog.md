# System prompt dialog

## Goal

The context-window popover on the chat input shows how large the system prompt is
(a percentage), but not what it says. Add a "Show system prompt" button to that
popover. It opens a dialog with the system prompt the model receives in the
current conversation.

## Product rules

- Scope is the system prompt only: sections whose injection target is `system`,
  excluding the `skills` and `tools` sections. These are exactly the sections the
  breakdown already counts as "System prompt". Meta user context, skills, and tool
  schemas are out of scope.
- The dialog shows the prompt of the current session as of its most recent model
  request. If the session has not built a prompt yet, the dialog says so instead
  of showing an empty body.
- Each section is shown as a titled block (its human-readable name) with its text
  in a monospaced, scrollable, selectable area. The dialog has a copy-all button.
- The text is read-only. It is fetched when the dialog opens and is not streamed,
  so the popover and the event stream do not grow.
- The dialog works on desktop and on the web build, and is localised (en-US,
  zh-CN).

## State owner and data flow

The runtime owns the prompt: `AgentRuntime.latestContextBuildResult` is rebuilt
before each model request. Nothing is copied or cached elsewhere.

```
UI dialog open
  -> useSessionSystemPrompt (hook)
  -> nexAgentService.readSessionSystemPrompt   (services)
  -> protocol command session/systemPrompt     (shared schema)
  -> bootstrap handler: requireSession(...).app.runtime.getSystemPromptSections()
  -> AgentRuntime reads latestContextBuildResult.sections
```

The command is read-only and idempotent. It does not resume a cold session
(`existing-only`, the same as `session/debug`); a session without a live runtime
returns an error that the dialog shows as "not available".

## Interface

`session/systemPrompt`

- params: `{ sessionId: string }`
- result: `{ sessionId: string, sections: Array<{ name, source, cacheHint, content }> }`

`sections` is empty when no prompt has been built yet.

## Acceptance

1. Core: `getSystemPromptSections()` returns only system-target sections, drops
   `skills` and `tools`, and returns `[]` before the first build.
2. Protocol: params and result schemas reject unknown fields and wrong types.
3. Bootstrap: the command returns the runtime sections for a live session and
   errors for an unknown session.
4. UI: the button opens the dialog; sections render with names; the empty and
   error states render; copy-all copies the joined text.
5. Browser check on the web build: open the popover, click the button, see the
   real prompt text.
