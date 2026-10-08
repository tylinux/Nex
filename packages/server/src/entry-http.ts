import { join } from "node:path";
import { createLocalServices, getAppConfigDir } from "@nex/services/node";
import {
  materializeBundledNexBuiltinProviderConfig,
  readBundledNexBuiltinProviderConfig,
} from "./bundledNexBuiltinProviderConfig.js";
import { createHttpServer } from "./http.js";

async function main(): Promise<void> {
  const nexBuiltinProviderConfigFilePath = await materializeBundledNexBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledNexBuiltinProviderConfig(),
  });
  const port = Number(process.env["PORT"]) || 3030;
  const host = process.env["NEX_SERVER_HOST"]?.trim() || process.env["HOST"]?.trim() || undefined;
  const staticRoot = process.env["NEX_WEB_STATIC_ROOT"]?.trim() || undefined;
  const authToken = process.env["NEX_SERVER_AUTH_TOKEN"]?.trim() || undefined;
  const services = createLocalServices({
    nexBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(authToken),
  });

  createHttpServer(services, port, {
    ...(host ? { host } : {}),
    ...(staticRoot ? { staticRoot, spaFallback: true } : {}),
    ...(authToken
      ? {
          authToken,
          authRequired: true,
          sessionsFilePath: join(getAppConfigDir(), "web-sessions.json"),
        }
      : {}),
  });
}

void main().catch((error: unknown) => {
  console.error("[nex-server:http] startup failed", error);
  process.exitCode = 1;
});
