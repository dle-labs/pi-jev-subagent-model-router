import type { JevRouterConfig } from "./config";
import type { SpendSnapshot } from "./budget";

/**
 * Typed judgments asked of Jev for a single incoming request.
 *
 * Design note: Jev judges the *task* (what it is, how hard it is, how much
 * capability it deserves). Code judges *budget* (what we can afford right now).
 * Keeping those separate means the budget policy can change without invalidating
 * the judgment, and the judgment stays a pure semantic read of the request.
 */

export interface RouteAnalysis {
  kind: string;
  kindConfidence: number;
  kindProbabilities: Record<string, number>;
  /** Probability-weighted 0..3 position on the complexity rubric. */
  complexity: number;
  complexityConfidence: number;
  /** Probability-weighted 0..3 position on "capability this deserves". */
  budgetIntensity: number;
  budgetIntensityConfidence: number;
  /** Probability this request needs extended reasoning rather than recall/short edits. */
  deepReasoning: number;
  latencyMs: number;
  usage?: { input_tokens: number; output_tokens: number };
  /** Present only when the request was capped; counts are UTF-16 string characters. */
  requestTruncation?: { originalChars: number; sentChars: number };
}

export interface ClassifyInput {
  prompt: string;
  history?: string;
  cwd?: string;
  activeModel?: string;
  contextTokens?: number;
  spend: SpendSnapshot;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

function buildState(input: ClassifyInput): Record<string, unknown> {
  return {
    request: input.prompt.slice(0, 8000),
    conversation_excerpt: input.history?.slice(-4000) ?? null,
    environment: {
      cwd: input.cwd ?? null,
      active_model: input.activeModel ?? null,
      context_tokens_used: input.contextTokens ?? null,
    },
    budget: {
      spent_today_usd: input.spend.today,
      spent_this_month_usd: input.spend.month,
      daily_cap_usd: input.spend.dailyCap ?? null,
      monthly_cap_usd: input.spend.monthlyCap ?? null,
      fraction_of_budget_used: input.spend.pressure,
    },
  };
}

function buildQuestions(taskKinds: Record<string, string>): Record<string, unknown> {
  return {
    task_kind: {
      type: "choice",
      instructions:
        "Which single kind of work does `request` ask for? Judge the work the user wants done, not the topic they mention. Read `conversation_excerpt` when the request is a short follow-up that only makes sense in context. Pick the closest kind even when the request is ambiguous.",
      criteria: taskKinds,
    },
    complexity: {
      type: "score",
      instructions:
        "How hard is `request` to do well, judged only on the work itself? Use the conversation excerpt and environment to judge scope. Ignore how much any model costs.",
      criteria: [
        "Trivial: one obvious step, no design decisions, answer is known or mechanical",
        "Moderate: a few dependent steps using familiar patterns, little ambiguity",
        "Complex: multiple files or interacting constraints, real tradeoffs to weigh",
        "Architectural: cross-cutting design, high stakes, long horizon, easy to get subtly wrong",
      ],
    },
    capability_deserved: {
      type: "score",
      instructions:
        "Setting price aside entirely, how much model capability does this request deserve to get a good outcome? Judge by stakes, difficulty, and how much a stronger model would measurably improve the result.",
      criteria: [
        "Minimal: any fast small model answers this just as well",
        "Standard: a competent mid-tier model is enough",
        "High: a strong frontier model materially improves the outcome",
        "Maximum: correctness matters more than cost; use the best available",
      ],
    },
    needs_deep_reasoning: {
      type: "noul",
      instructions:
        "Does answering `request` well require extended multi-step reasoning (algorithm design, subtle debugging, proof, careful long-horizon planning) rather than recall, lookup, or a short direct edit?",
      criteria: {
        true: "The work hinges on reasoning through non-obvious steps or edge cases",
        false: "The work is recall, lookup, formatting, or a short direct change",
      },
    },
  };
}

/** Validate an untrusted number without reflecting its value or caller-supplied label. */
export function finiteRange(value: unknown, min: number, max: number, _label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new JevError("Jev returned an invalid numeric field");
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JevError("Jev returned an invalid response object");
  }
  return value as Record<string, unknown>;
}

function answer(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.hasOwn(parent, key) ? object(parent[key]) : {};
}

function field(parent: Record<string, unknown>, key: string, max: number, fallback: number): number {
  return Object.hasOwn(parent, key) ? finiteRange(parent[key], 0, max, key) : fallback;
}

function parseAnalysis(payload: unknown, latencyMs: number, taskKinds: Record<string, string>): RouteAnalysis {
  const root = object(payload);
  const answers = answer(root, "answers");
  const kind = answer(answers, "task_kind");
  const complexity = answer(answers, "complexity");
  const capability = answer(answers, "capability_deserved");
  const reasoning = answer(answers, "needs_deep_reasoning");
  const chosenKind = Object.hasOwn(kind, "choice") ? kind.choice : "chat";
  if (typeof chosenKind !== "string" || !Object.hasOwn(taskKinds, chosenKind)) {
    throw new JevError("Jev returned an invalid task kind");
  }
  const probabilities = answer(kind, "probabilities");
  for (const [key, value] of Object.entries(probabilities)) {
    if (!Object.hasOwn(taskKinds, key)) throw new JevError("Jev returned an invalid probability kind");
    finiteRange(value, 0, 1, "probability");
  }
  const legacyReasoning = field(reasoning, "noul_score", 1, 0);
  const deepReasoning = field(reasoning, "noul", 1, legacyReasoning);
  let usage: RouteAnalysis["usage"];
  if (Object.hasOwn(root, "usage")) {
    const supplied = object(root.usage);
    const inputTokens = field(supplied, "input_tokens", Number.MAX_VALUE, 0);
    const outputTokens = field(supplied, "output_tokens", Number.MAX_VALUE, 0);
    if (Object.hasOwn(supplied, "input_tokens")) usage = { input_tokens: inputTokens, output_tokens: outputTokens };
  }
  return {
    kind: chosenKind,
    kindConfidence: field(kind, "confidence", 1, 0),
    kindProbabilities: probabilities as Record<string, number>,
    complexity: field(complexity, "score", 3, 1),
    complexityConfidence: field(complexity, "confidence", 1, 0),
    budgetIntensity: field(capability, "score", 3, 1),
    budgetIntensityConfidence: field(capability, "confidence", 1, 0),
    deepReasoning,
    latencyMs,
    usage,
  };
}

interface RequestBudget {
  signal: AbortSignal;
  check(): void;
}

/** Timers interrupt waits; the monotonic deadline also guards synchronous work. */
function requestBudget(signal: AbortSignal, timeoutMs: number, cancel: () => void): RequestBudget {
  const deadline = performance.now() + timeoutMs;
  return {
    signal,
    check() {
      if (performance.now() >= deadline) cancel();
      if (signal.aborted) throw new JevError("aborted");
    },
  };
}

/** Race even transports that ignore signal; both loser outcomes remain observed. */
function abortable<T>(budget: RequestBudget, operation: () => Promise<T>): Promise<T> {
  const { signal } = budget;
  return new Promise<T>((resolve, reject) => {
    budget.check();
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(new JevError("aborted")); };
    signal.addEventListener("abort", aborted, { once: true });
    // Recheck inside the queued operation: an earlier microtask may exhaust time.
    Promise.resolve().then(() => { budget.check(); return operation(); }).then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        try { budget.check(); resolve(value); } catch (error) { reject(error); }
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        try { budget.check(); reject(error); } catch (abortedError) { reject(abortedError); }
      },
    );
  });
}

function backoff(ms: number, budget: RequestBudget): Promise<void> {
  const { signal } = budget;
  return new Promise((resolve, reject) => {
    budget.check();
    const aborted = () => { clearTimeout(timer); signal.removeEventListener("abort", aborted); reject(new JevError("aborted")); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      try { budget.check(); resolve(); } catch (error) { reject(error); }
    }, ms);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function postWithRetry(
  config: JevRouterConfig,
  apiKey: string,
  body: unknown,
  budget: RequestBudget,
): Promise<unknown> {
  const { signal } = budget;
  budget.check();
  const endpoint = process.env[config.endpointEnv]?.trim() || config.endpoint;
  const serialized = JSON.stringify(body);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    budget.check();
    let res: Response;
    try {
      res = await abortable(budget, () => fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: serialized,
        redirect: "error",
        signal,
      }));
    } catch (error) {
      budget.check();
      // Fetch failures are transient; never retain transport messages or causes.
      if (!(error instanceof Error) || attempt === 2) throw new JevError("TypeSafe request failed");
      await backoff(200 * (attempt + 1), budget);
      continue;
    }
    budget.check();
    if (!res.ok) {
      const status = typeof res.status === "number" && Number.isInteger(res.status) && res.status >= 100 && res.status <= 599
        ? res.status : undefined;
      budget.check();
      if ((status === 429 || status === 529) && attempt < 2) {
        await backoff(200 * (attempt + 1), budget);
        continue;
      }
      // Error bodies may contain credentials, task text or provider diagnostics.
      throw new JevError(status === undefined ? "TypeSafe request failed" : `TypeSafe HTTP ${status}`, status);
    }
    try {
      const result = await abortable(budget, () => res.json());
      budget.check();
      return result;
    } catch {
      budget.check();
      throw new JevError("TypeSafe returned invalid JSON");
    }
  }
  throw new JevError("TypeSafe request failed");
}

/** Run one Jev evaluation (4 questions, parallel server-side) for the prompt. */
export async function classifyRequest(
  input: ClassifyInput,
  config: JevRouterConfig,
  apiKey: string,
  externalSignal?: AbortSignal,
): Promise<RouteAnalysis> {
  // Avoid runtime RangeErrors (and reflected values) for malformed configuration.
  if (typeof config.timeoutMs !== "number" || !Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 2_147_483_647) {
    throw new JevError("Invalid Jev deadline configuration");
  }
  const started = Date.now();
  const controller = new AbortController();
  const cancelled = () => controller.abort();
  const budget = requestBudget(controller.signal, config.timeoutMs, cancelled);
  externalSignal?.addEventListener("abort", cancelled, { once: true });
  if (externalSignal?.aborted) cancelled();
  const timer = setTimeout(cancelled, config.timeoutMs);
  try {
    budget.check();
    const payload = await postWithRetry(
      config,
      apiKey,
      { state: buildState(input), model: config.jevModel, questions: buildQuestions(config.taskKinds) },
      budget,
    );
    budget.check();
    const analysis = parseAnalysis(payload, Date.now() - started, config.taskKinds);
    budget.check();
    if (input.prompt.length > 8000) analysis.requestTruncation = { originalChars: input.prompt.length, sentChars: 8000 };
    budget.check();
    return analysis;
  } catch (error) {
    budget.check();
    if (error instanceof JevError) throw error;
    throw new JevError("TypeSafe request failed");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", cancelled);
  }
}