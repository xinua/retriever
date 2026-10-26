import { Observable } from 'rxjs';
import clean from 'semver/functions/clean';
import gt from 'semver/functions/gt';
import lt from 'semver/functions/lt';
import type { Nullable } from '../models/common.model';
import type { DownloadModel } from '../models/download.model';

export function equal<T, R>(source: T, target: R): boolean {
  return Object.keys(source).every((key) =>
    target?.hasOwnProperty(key)
      ? source[key] && typeof source[key] === 'object'
        ? equal(source[key], target[key])
        : source[key] === target[key]
      : false,
  );
}

export function equalJson<T, R>(source: T, target: R): boolean {
  return JSON.stringify(source) === JSON.stringify(target);
  // return source.split(':').map(Number).reduce((acc, curr) => acc * 60 + curr, 0) === target.split(':').map(Number).reduce((acc, curr) => acc * 60 + curr, 0);
}

export const textWriterEffect = (text: string): Observable<string> => {
  return new Observable<string>((subscriber) => {
    let currentIndex = 0;
    const interval = setInterval(() => {
      subscriber.next(text.slice(0, currentIndex));
      currentIndex++;
      if (currentIndex > text.length) {
        clearInterval(interval);
        subscriber.complete();
      }
    }, 100);
  });
};

export const clearTextEffect = (text: string): Observable<string> => {
  return new Observable<string>((subscriber) => {
    let currentIndex = text.length;
    const interval = setInterval(() => {
      subscriber.next(text.slice(0, currentIndex));
      currentIndex--;
      if (currentIndex < 0) {
        clearInterval(interval);
        subscriber.complete();
      }
    }, 100);
  });
};

/**
 * Whether a download has a file that can be played or saved. The server's
 * on-disk answer when the row carries one; otherwise the path alone, which is
 * right for the rows the websocket pushes — a download that just finished, or
 * a path that was just set, has its file.
 */
export function hasFile(download: Nullable<DownloadModel>): boolean {
  return download?.fileExists ?? !!download?.filePath;
}

/** The browser's IANA time zone, such as `Europe/Kyiv`. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every IANA zone the browser knows, for pickers. Falls back to just the browser's own. */
export function supportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const zones = intl.supportedValuesOf?.('timeZone') ?? [];
  const own = browserTimeZone();

  // UTC is missing from some engines' list, and it is the server default.
  return [...new Set([own, 'UTC', ...zones])].sort();
}

/** A folder as the server compares it: no empty segments, no slash at either end. */
export function normalizeFolder(folder: string): string {
  return folder
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

/** The folder part of a root-relative file path; "" for the root. */
export function folderOf(filePath: Nullable<string>): string {
  return normalizeFolder((filePath ?? '').split(/[\\/]/).slice(0, -1).join('/'));
}

/** Whether any video or audio inside `root` is playing; a paused or finished one doesn't count. */
export function isMediaPlaying(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll<HTMLMediaElement>('video, audio')).some(
    (media) => !media.paused && !media.ended,
  );
}

/**
 * Where an installed version stands against the latest published one:
 * `update` when a newer one is out, `ahead` for a build newer than anything
 * published (a dev build), `unknown` when either side is missing or isn't a
 * version. Compared as semver, so `1.0.10` is past `1.0.9` and `1.3.1-rc1`
 * comes before `1.3.1`.
 */
export function versionStatus(installed: Nullable<string>, latest: Nullable<string>): VersionStatus {
  const a = installed ? clean(installed) : null;
  const b = latest ? clean(latest) : null;

  if (!a || !b) return 'unknown';
  if (lt(a, b)) return 'update';
  if (gt(a, b)) return 'ahead';
  return 'current';
}

export type VersionStatus = 'unknown' | 'current' | 'update' | 'ahead';
