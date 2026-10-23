import { EnvironmentProviders, inject, Injectable, Provider } from '@angular/core';
import { HttpBackend } from '@angular/common/http';
import { HttpService } from '../src/app/shared/services/http.service';
import { WS_SOCKET } from '../src/app/shared/services/ws.service';
import { DemoBackend } from './demo-backend';
import { DemoSocket } from './demo-socket';
import { DemoStore } from './demo-store';

/** Files are static on GitHub Pages: a row plays its sample file, not `/api/downloads/:id/file`. */
@Injectable({ providedIn: 'root' })
class DemoHttpService extends HttpService {
  private readonly _store = inject(DemoStore);

  override downloadFileUrl(id: number): string {
    return this._store.mediaUrl(id);
  }

  override streamFileUrl(id: number): string {
    return this._store.mediaUrl(id);
  }
}

/** Replaces src/app/demo.providers.ts in the `demo` build configuration. */
export const demoProviders: (Provider | EnvironmentProviders)[] = [
  { provide: HttpBackend, useExisting: DemoBackend },
  { provide: WS_SOCKET, useExisting: DemoSocket },
  { provide: HttpService, useExisting: DemoHttpService },
];
