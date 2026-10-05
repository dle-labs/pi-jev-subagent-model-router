import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquireWithin } from "./setup-deadline";

export type NativeToolCall = { id: string; name: "Agent"; arguments: Record<string, unknown> };
export const managerKey = Symbol.for("pi-subagents:manager");

// Only fixtures are authored here. The actual published extension is loaded unchanged.
export async function prepareNativeFiles(cwd: string, agentDir: string) {
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(cwd, ".pi", "subagents.json"), JSON.stringify({
    schedulingEnabled: false, workflowsEnabled: false, rememberAgents: false,
    outputTranscript: false, worktreeIsolation: false, maxSubagentDepth: 0,
    disableDefaultAgents: true, fallbackSubagent: "none", backgroundByDefault: false,
    fleetView: false, widgetMode: "off", agentMentions: "off",
  }));
  await writeFile(join(cwd, ".pi", "agents", "probe.md"), [
    "---", "name: probe", "description: Deterministic race fixture", "tools: none",
    "extensions: false", "skills: false", "isolated: true", "persist_session: false",
    "output_transcript: false", "---", "Respond using the local fake provider only.", "",
  ].join("\n"));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { enabled: false },
    packages: [], extensions: [],
  }));
}

export async function createNativeParent(
  sdk: Record<string, any>, cwd: string, agentDir: string, tintinEntry: string,
  runtime: any, model: any, settings: any, disposeLate: (result: any) => Promise<void>,
  observer: { eventBus?: any; extensionFactories?: any[] } = {},
) {
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager: settings, additionalExtensionPaths: [tintinEntry],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: "Deterministic native Agent-tool fixture.",
    ...observer,
  });
  await acquireWithin(() => loader.reload({ resolveProjectTrust: async () => true }), "Tintin loader", async () => {});
  const errors = loader.getExtensions().errors;
  if (errors.length) throw new Error(`Tintin loader failed: ${JSON.stringify(errors)}`);
  const result = await acquireWithin<any>(() => sdk.createAgentSession({
    cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: "off", settingsManager: settings,
    sessionManager: sdk.SessionManager.inMemory(cwd), resourceLoader: loader, tools: ["Agent"],
  }), "native parent setup", disposeLate);
  try {
    const bindErrors: string[] = [];
    await acquireWithin(() => result.session.bindExtensions({ mode: "json", onError: (e: { message: string }) => bindErrors.push(e.message) }),
      "Tintin session startup", async () => { await disposeLate(result); });
    if (bindErrors.length) throw new Error(`Tintin binding failed: ${bindErrors.join("; ")}`);
    if (!result.session.getActiveToolNames().includes("Agent")) throw new Error("Native Agent tool is not active");
    const registry = (globalThis as any)[managerKey];
    if (!registry || typeof registry.getRecord !== "function") throw new Error("Public Tintin registry unavailable");
    return result.session;
  } catch (error) { await disposeLate(result); throw error; }
}

export async function nativeCall(parent: any, call: NativeToolCall, enqueue: (call: NativeToolCall) => void,
  options: { allowPendingBackground?: boolean } = {}) {
  enqueue(call);
  await parent.prompt(`Execute the deterministic native call ${call.id}`);
  const result = parent.messages.find((m: any) => m.role === "toolResult" && m.toolCallId === call.id);
  if (!result || result.isError || result.details?.status === "error") {
    throw new Error(`Native Agent call failed: ${JSON.stringify(result ?? null)}`);
  }
  const id = result.details?.agentId;
  const record = typeof id === "string" ? (globalThis as any)[managerKey]?.getRecord(id) : undefined;
  // Foreground spawn/resume can leave record.toolCallId absent in Tintin 0.19.0.
  // Correlate the exact native receipt with the requested child; the caller also
  // verifies resume retains the same SDK session. Reject a conflicting optional ID.
  const pendingBackground = options.allowPendingBackground && call.arguments.run_in_background === true &&
    result.details?.status === "background" && ["running", "queued"].includes(record?.status);
  // A detached spawn can acknowledge before SDK creation. Its caller must await
  // an actual startup signal and then verify the retained session, not assume one.
  if (!record || (!record.session && !pendingBackground) || record.id !== id ||
      (call.arguments.resume && call.arguments.resume !== id) ||
      (record.toolCallId !== undefined && record.toolCallId !== call.id)) {
    throw new Error(`Native receipt correlation failed: ${JSON.stringify({ call: call.id, receiptId: id, recordId: record?.id,
      recordToolCallId: record?.toolCallId, hasSession: Boolean(record?.session), details: result.details })}`);
  }
  return record;
}

export async function shutdownNative(parent: any) {
  if (parent?.extensionRunner) await parent.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
}
