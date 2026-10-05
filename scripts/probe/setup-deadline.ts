// Acquisition differs from an ordinary timeout: a late resource must be disposed.
export async function acquireWithin<T>(
  start: (signal: AbortSignal) => Promise<T>, label: string,
  disposeLate: (value: T) => Promise<void>, timeoutMs = 5_000,
): Promise<T> {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const acquired = Promise.resolve().then(() => start(controller.signal)).then(async value => {
    if (expired) {
      try { await disposeLate(value); }
      catch { console.error(`Late resource cleanup failed: ${label}`); }
    }
    return value;
  });
  try {
    return await Promise.race([acquired, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        reject(new Error(`Probe timed out at ${label}`));
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
