/**
 * Mirrors the payload the backend posts on a new video — see
 * sendWebhook() in backend/src/services/worker.ts. Keep the keys in step.
 */
export const WEBHOOK_SNACKBAR_DATA = {
  watcherId: 1,
  channel: 'Channel Name',
  videoId: '4f35jL3Wd',
  title: 'Video Title',
  type: 'video',
  date: new Date().toISOString(),
};

/** The example with a fresh timestamp — what the test-send button posts. */
export function webhookExamplePayload(): typeof WEBHOOK_SNACKBAR_DATA {
  return { ...WEBHOOK_SNACKBAR_DATA, date: new Date().toISOString() };
}
