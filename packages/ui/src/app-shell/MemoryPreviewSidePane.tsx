import { useEffect, useRef, useState } from "react";
import {
  type IMemoryService,
  PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE,
} from "@nex/services";
import {
  TID_SETTINGS_MEMORY_FILE_PREVIEW,
  TID_SETTINGS_MEMORY_FILE_PREVIEW_RETRY,
  testId,
} from "@nex/shared";
import { Button } from "@/components/ui/button.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";
import { useNexStoreWithDefault } from "@/store/StoreProvider.js";
import type { Theme } from "@/useTheme.js";
import type { MemoryPreviewSidePaneTab } from "@/lib/workspaceSidePane.js";

type MemoryPreviewLoadState =
  | { phase: "loading" }
  | { phase: "ready"; content: string }
  | { phase: "error"; message: string; oversized: boolean };

/**
 * Memory 文件预览侧边面板。
 *
 * 正文权威在 IMemoryService（本地 Host RPC）；tab 只携带身份，每次挂载/切换
 * 文件都重读。请求按序号判旧：快速切换文件时，晚到的旧响应直接丢弃，不能
 * 覆盖当前文件的正文。
 */
function MemoryPreviewContent({
  tab,
  memoryService,
  onClose,
}: {
  tab: MemoryPreviewSidePaneTab;
  memoryService: IMemoryService | undefined;
  onClose: () => void;
}) {
  const { intl } = useNexIntl();
  const theme = useNexStoreWithDefault((state) => state.theme, "system" as Theme);
  const codePreviewSettings = useNexStoreWithDefault(
    (state) => state.codePreviewSettings,
    DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const [state, setState] = useState<MemoryPreviewLoadState>({ phase: "loading" });
  const [reloadSeq, setReloadSeq] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!memoryService) {
      setState({ phase: "error", message: intl.formatMessage({ id: "settings.memory.preview.serviceUnavailable" }), oversized: false });
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState({ phase: "loading" });
    memoryService
      .readProjectMemoryFile({ workspaceId: tab.workspaceId, fileName: tab.fileName })
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setState({ phase: "ready", content: result.content });
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;
        const isOversized =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE;
        setState({
          phase: "error",
          message: isOversized
            ? intl.formatMessage({ id: "settings.memory.preview.tooLarge" })
            : error instanceof Error
              ? error.message
              : String(error),
          oversized: isOversized,
        });
      });
  }, [intl, memoryService, reloadSeq, tab.fileName, tab.workspaceId]);

  return (
    <div
      data-testid={testId(TID_SETTINGS_MEMORY_FILE_PREVIEW, tab.fileName)}
      className="h-full min-h-0 overflow-y-auto bg-background px-4 py-4"
    >
      {state.phase === "loading" ? (
        <div className="flex h-full items-center justify-center text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.memory.preview.loading" })}
        </div>
      ) : state.phase === "error" ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-ui-base text-foreground-subtle">{state.message}</p>
          {state.oversized ? (
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {intl.formatMessage({ id: "common.close" })}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={TID_SETTINGS_MEMORY_FILE_PREVIEW_RETRY}
              onClick={() => setReloadSeq((seq) => seq + 1)}
            >
              {intl.formatMessage({ id: "settings.memory.viewer.refresh" })}
            </Button>
          )}
        </div>
      ) : (
        <MessageResponse
          className="mx-auto w-full max-w-4xl min-w-0 break-words text-foreground"
          theme={theme}
          codePreviewSettings={codePreviewSettings}
        >
          {state.content}
        </MessageResponse>
      )}
    </div>
  );
}

export function MemoryPreviewSidePane({
  tab,
  memoryService,
  onClose,
}: {
  tab: MemoryPreviewSidePaneTab;
  memoryService: IMemoryService | undefined;
  onClose: () => void;
}) {
  return (
    <MemoryPreviewContent
      key={`${tab.workspaceId}:${tab.fileName}`}
      tab={tab}
      memoryService={memoryService}
      onClose={onClose}
    />
  );
}
