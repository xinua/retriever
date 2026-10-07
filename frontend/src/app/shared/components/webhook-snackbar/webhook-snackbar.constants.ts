/**
 * Mirrors the payload the backend posts when a subscription's download
 * finishes - see notifyWebhook() in backend/src/services/notify.ts. Keep the
 * keys in step.
 */

import { notifyWebhook } from '../../constants/code.const';

/** The example with a fresh timestamp — what the test-send button posts. */
export function webhookExamplePayload() {
  return { ...notifyWebhook, date: new Date().toISOString() };
}
