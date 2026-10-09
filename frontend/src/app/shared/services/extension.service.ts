import { DestroyRef, inject, Injectable, signal } from '@angular/core';

const APP_SOURCE = 'retriever-app';
const EXTENSION_SOURCE = 'retriever-extension';

/**
 * Whether the Retriever browser extension is installed, and which version.
 *
 * The extension injects a small bridge script into this app's pages once the
 * user lets it (from the extension's options page). The unpacked build has no
 * fixed ID to message, so the two talk through window.postMessage: the bridge
 * says hello on load, and answers our ping in case it loaded first.
 */
@Injectable({
  providedIn: 'root',
})
export class ExtensionService {
  private readonly _version = signal<string | null>(null);

  /** Null until the extension says hello, which may be never. */
  readonly version = this._version.asReadonly();

  constructor() {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== EXTENSION_SOURCE || e.data.type !== 'hello') return;
      this._version.set(String(e.data.version));
    };
    window.addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('message', onMessage));

    window.postMessage({ source: APP_SOURCE, type: 'ping' }, location.origin);
  }
}
