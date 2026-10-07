export function formatNotifyAutomation(automation: string, webhook: string): string {
  const webhookId = webhook.split('/').pop();
  automation = automation.replace('<webhook_id>', webhookId);
  return automation;
}

export function formatPlayDownloadAutomation(automation: string, webhook: string): string {
  const webhookId = webhook.split('/').pop();
  automation = webhookId ? automation.replace('<webhook_id>', webhookId) : automation;
  automation = automation.replace('<retriever_url>', window.location.origin);
  return automation;
}
