/** Browser adapter for the scheduler capability shared by discern UI modules. */

/** Schedule one browser interval at the sole browser timer authority. */
function scheduleBrowserInterval(callback, intervalMs) {
  return globalThis.setInterval(callback, intervalMs);
}

/** Cancel one browser interval at the sole browser timer authority. */
function cancelBrowserInterval(handle) {
  globalThis.clearInterval(handle);
}

/** Schedule one browser timeout at the sole browser timer authority. */
function scheduleBrowserTimeout(callback, delayMs) {
  return globalThis.setTimeout(callback, delayMs);
}

/** Cancel one browser timeout at the sole browser timer authority. */
function cancelBrowserTimeout(handle) {
  globalThis.clearTimeout(handle);
}

/** Browser scheduler with the same operations as the Deno system scheduler. */
export const SYSTEM_SCHEDULER = Object.freeze({
  scheduleTimeout: scheduleBrowserTimeout,
  cancelTimeout: cancelBrowserTimeout,
  scheduleInterval: scheduleBrowserInterval,
  cancelInterval: cancelBrowserInterval,
});

/** Race one browser effect against a timeout and always retire the watchdog. */
export async function withTimeout(
  effect,
  delayMs,
  timeoutMessage,
  scheduler = SYSTEM_SCHEDULER,
) {
  let watchdog;
  const timeout = new Promise((_, reject) => {
    watchdog = scheduler.scheduleTimeout(
      () => reject(new Error(timeoutMessage)),
      delayMs,
    );
  });
  try {
    return await Promise.race([effect, timeout]);
  } finally {
    scheduler.cancelTimeout(watchdog);
  }
}
