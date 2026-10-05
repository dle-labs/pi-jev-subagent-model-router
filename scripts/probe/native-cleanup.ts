export interface NativeCleanup {
  releaseAuthentication: () => void;
  abort: () => Promise<void>;
  shutdown: () => Promise<void>;
  dispose: () => void;
  unsubscribe: (() => void)[];
  restoreFetch: () => void;
  restoreCwd: () => void;
  removeTemp: () => Promise<void>;
}

// Callers supply bounded native operations; synchronous teardown stays synchronous.
export async function withNativeCleanup<T>(body: () => Promise<T>, cleanup: NativeCleanup): Promise<T> {
  let bodyFailed = false;
  const errors: unknown[] = [], stages: string[] = [];
  const record = (stage: string, error: unknown) => { stages.push(stage); errors.push(error); };
  const attempt = (stage: string, action: () => void) => {
    try { action(); } catch (error) { record(stage, error); }
  };
  const attemptAsync = async (stage: string, action: () => Promise<void>) => {
    try { await action(); } catch (error) { record(stage, error); }
  };
  try { return await body(); }
  catch (error) { bodyFailed = true; throw error; }
  finally {
    attempt("releaseAuthentication", cleanup.releaseAuthentication);
    try {
      await attemptAsync("abort", cleanup.abort);
    } finally {
      try { await attemptAsync("shutdown", cleanup.shutdown); }
      finally { attempt("dispose", cleanup.dispose); }
    }
    for (const [index, off] of cleanup.unsubscribe.entries()) attempt(`unsubscribe:${index}`, off);
    attempt("restoreFetch", cleanup.restoreFetch);
    attempt("restoreCwd", cleanup.restoreCwd);
    await attemptAsync("removeTemp", cleanup.removeTemp);
    // A boolean, not the thrown value's truthiness, preserves even `throw undefined`.
    if (!bodyFailed && errors.length) throw new AggregateError(errors, `Native fixture cleanup failed: ${stages.join(", ")}`);
  }
}
