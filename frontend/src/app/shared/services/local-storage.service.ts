import { Injectable } from '@angular/core';
import { DefaultLocalStorage } from '../constants/defaults.const';
import { LocalStorageKey, LocalStorageModel } from '../models/local-storage.model';

@Injectable({
  providedIn: 'root',
})
export class LocalStorage {
  get<K extends LocalStorageKey>(key: K): LocalStorageModel[K] {
    return this._validate(this._read(key), DefaultLocalStorage[key]);
  }

  set<K extends LocalStorageKey>(key: K, value: LocalStorageModel[K]): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Persisting is a convenience.
    }
  }

  has(key: LocalStorageKey): boolean {
    return this._read(key) !== undefined;
  }

  remove(key: LocalStorageKey): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to undo if storage is unavailable.
    }
  }

  private _read(key: LocalStorageKey): unknown {
    try {
      const raw = localStorage.getItem(key);

      return raw === null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  private _validate<T>(stored: unknown, fallback: T): T {
    if (Array.isArray(fallback)) return (Array.isArray(stored) ? [...stored] : [...fallback]) as T;

    if (this._isRecord(fallback)) {
      if (!this._isRecord(stored)) return { ...fallback };

      const valid: Record<string, unknown> = {};

      for (const [field, value] of Object.entries(fallback)) {
        const candidate = stored[field];

        if (candidate === undefined) continue;
        if (value !== null && typeof candidate !== typeof value) continue;

        valid[field] = candidate;
      }

      return Object.assign({ ...fallback }, valid);
    }

    if (stored === undefined) return fallback;
    // A null default carries no type to check against.
    if (fallback !== null && typeof stored !== typeof fallback) return fallback;

    return stored as T;
  }

  private _isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
