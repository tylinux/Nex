# Prompt context dialog

## Goal

The context-window popover on the chat input shows how large each part of the
model input is (a percentage per source), but not what it says. Add a "Show
system prompt" button to that popover. It opens a dialog, with one tab per
source, showing everything the model receives in the current conversation
except the conversation messages themselves.

## Product rules

- Tabs follow the popover's breakdown rows, in this order, and a tab is shown
  only when it has content:
  1. System prompt: sections injected as system, excluding skills and tool prompt.
  2. Meta context: sections injected as the meta-user context, excluding skills.
  3. Skills: the skills listing.
  4. Tool prompt: the text sections that describe tool usage.
  5. System tools: schemas of built-in tools sent in the request.
  6. MCP tools: schemas of MCP tools sent in the request.
- Conversation messages are out of scope.
- Tool tabs list exactly the tools the model receives in a request: deferred
  tools that have not been found by `ToolSearch` and hidden tools are absent,
  because they are not sent. Each tool is a titled block with its description and
  input schema as JSON.
- The dialog shows the state as of the most recent model request. If the session
  has not built a prompt yet it says so.
- Text is read-only, monospaced, scrollable and selectable. "Copy all" copies the
  active tab.
- It is fetched when the dialog opens and is not streamed.
- Works on desktop and web; localised (en-US, zh-CN).

## State owner and data flow

The runtime owns all of it: `latestContextBuildResult` for text sections and
`getTools()` for tool schemas. Nothing is copied or cached elsewhere.

```
dialog open
  -> useSessionPromptContext (hook)
  -> nexAgentService.readSessionPromptContext     (services)
  -> protocol command session/promptContext       (shared schema)
  -> bootstrap: requireSession(...).app.runtime.getPromptContextEntries()
  -> AgentRuntime: sections + getTools(), each tagged with a category
```

Read-only and idempotent. It does not resume a cold session (`existing-only`,
like `session/debug`); a session without a live runtime errors and the dialog
shows "not available".

## Interface

`session/promptContext`

- params: `{ sessionId: string }`
- result: `{ sessionId, entries: Array<{ category, name, source, content }> }`
- `category` is one of `system_prompt`, `meta_user_context`, `skills`,
  `tool_prompt`, `system_tool_schemas`, `mcp_tool_schemas`.

`entries` is empty when nothing has been built yet.

## Acceptance

1. Core: text sections are classified like the context-usage breakdown; tools
   come from `getTools()` and split into system vs MCP by name; empty before the
   first build.
2. Protocol: schemas reject unknown fields and unknown categories.
3. Bootstrap: returns runtime entries for a live session; errors for an unknown one.
4. UI: tabs appear only for categories with content; empty and error states;
   copy-all copies the active tab.
5. Browser check on the web build: every tab shows real content.
