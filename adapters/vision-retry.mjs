import { setTimeout as delay } from 'node:timers/promises';
import { fail } from './endpoints.mjs';

const RETRY_DELAYS = [1000, 2000];
const RETRY_WINDOW_MS = 90000;

function retryable(error) {
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return false;
  return error?.code === 'VISION_IMAGE_UPLOAD_FAILED' && error.status === 500
    || error?.code === 'VISION_UPSTREAM_ERROR' && [400, 502, 503].includes(error.status);
}

// Retry only a buffered model request. No response or tool call has reached
// the native harness yet, so an earlier computer/file action is never replayed.
export async function completeVisionWithRetry(vision, body, signal, { diagnostic = () => {}, retryDelays = RETRY_DELAYS } = {}) {
  const started = Date.now();
  const report = event => { try { diagnostic(event); } catch {} };
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const result = await vision.complete(body, signal);
      signal?.throwIfAborted();
      const choice = result?.choices?.[0];
      if (!choice?.message || !choice.finish_reason) throw fail('视觉模型没有返回完整回复。', 502, 'VISION_INCOMPLETE_RESPONSE');
      report({ attempt: attempt + 1, result: 'completed', elapsedMs: Date.now() - started });
      return result;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const elapsedMs = Date.now() - started;
      const waitMs = retryDelays[attempt];
      const retry = attempt < Math.min(2, retryDelays.length) && retryable(error)
        && Number.isFinite(waitMs) && waitMs >= 0 && elapsedMs + waitMs < RETRY_WINDOW_MS;
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'VISION_UPSTREAM_ERROR';
      report({ attempt: attempt + 1, result: retry ? 'retry' : 'failed',
        status: Number.isInteger(error?.status) ? error.status : 502, code, elapsedMs,
        ...(retry ? { retryDelayMs: waitMs } : {}) });
      if (!retry) throw error;
      await delay(waitMs, undefined, { signal });
    }
  }
}
