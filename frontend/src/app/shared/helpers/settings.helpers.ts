export function formatNotifyAutomation(automation: string, webhook: string): string {
  const webhookId = webhook.split('/').pop();
  automation = automation.replace('<webhook_id>', webhookId);
  return automation;
}

export function formatPlayDownloadAutomation(automation: string, webhook: string): string {
  const webhookId = webhook.split('/').pop();
  automation = webhookId ? automation.replace('<webhook_id>', webhookId) : automation;
  automation = automation.replace('<retriever_url>', baseUrl());
  return automation;
}

/** Where the app is served from, base href included: the origin unless it lives under a sub-path. */
export function baseUrl(): string {
  return document.baseURI.replace(/\/$/, '');
}
