import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedChild } from "../support/isolated-child";

async function probe(script: string, args: string[]) {
  const isolated = isolatedChild("run", [resolve(script), ...args]);
  const child = Bun.spawn(isolated.argv, { env: isolated.env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 60_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exit, err }).toEqual({ exit: 0, err: "" });
    return JSON.parse(out);
  } finally { clearTimeout(timer); }
}

test("published public pipeline preserves native precedence, receipts, scope and shutdown", async () => {
  const host = process.env.PI_PROBE_HOST_ROOT;
  if (!host) throw new Error("PI_PROBE_HOST_ROOT required: native gates never silently skip");
  const result = await probe("scripts/compatibility-probe.ts", ["--host-root", host,
    "--tintin-root", resolve("node_modules/@tintinweb/pi-subagents")]);
  expect(result.gate).toBe("3A");
  expect(result.publicControlMissing).toEqual(["Tintin.getIdleChildConfigurationSnapshot", "Tintin.configureIdleChild", "Tintin.getIdleChildConfigurationReceipt"]);
  expect(result.calls).toHaveLength(16);
  for (const call of result.calls) {
    for (const field of ["hostInputMutation", "definitionModelWins", "definitionThinkingWins", "nativeReceiptCorrelation",
      "retainedIdleSession", "parentUnchanged", "settingsUnchanged", "resumeIdentityPreserved"]) expect(call[field]).toBe(true);
    expect(call.nativeExecutionCount).toBe(1);
    if (!call.background) expect(call.nativeProgressPreserved).toBe(true);
    expect(call.observedModel).toEqual(call.expectedModel);
    expect(call.observedThinking).toBe(call.expectedThinking);
    expect(call.background ? call.backgroundReceiptPreserved : call.foregroundReceiptPreserved).toBe(true);
  }
  expect(result.schemaValidation.rejected).toBe(true);
  expect(result.schemaValidation.toolCallId).toBe("schema-invalid");
  expect(result.rpcPing).toEqual({ success: true, data: { version: 2 } });
  expect(result.scopeExcludedRejected).toBe(true);
  expect(result.scopeMutationSelectedAllowed).toBe(true);
  expect(result.shutdownListenerCount).toBe(0);
  expect(result.networkFetchAttempts).toBe(0);
  expect(result.fullRouterParityVerified).toBe(false);
}, 65_000);
