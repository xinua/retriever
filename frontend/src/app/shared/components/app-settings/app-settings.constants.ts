import {
  notifyAutomationExample,
  notifyWebhookExample,
  playDownloadAutomationExample,
  playWebhookExample,
  WIDGET_CODE,
} from '../../constants/code.const';
import { Browser, CodeExamples } from './app-settings.models';

export const EXTENSION_URLS: Record<Browser, string> = {
  [Browser.Chrome]: 'https://github.com/xinua/rt-ext/releases/latest/download/chrome.zip',
  [Browser.Firefox]: 'https://addons.mozilla.org/en-US/firefox/addon/retriever-ext/',
  [Browser.Other]: 'https://github.com/xinua/rt-ext',
};

export const codeExamples: CodeExamples = {
  webhooks: [
    {
      value: 'notifyWebhook',
      name: 'Notify Webhook',
      code: notifyWebhookExample,
    },
    {
      value: 'playWebhook',
      name: 'Play Webhook',
      code: playWebhookExample,
    },
  ],
  automations: [
    {
      value: 'notifyAutomation',
      name: 'Notify Automation',
      code: notifyAutomationExample,
    },
    {
      value: 'playAutomation',
      name: 'Play Automation',
      code: playDownloadAutomationExample,
    },
  ],
  widget: {
    value: 'cardWidget',
    name: 'Card widget',
    code: WIDGET_CODE(window.location.origin, 1),
  },
};
