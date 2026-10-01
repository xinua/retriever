import { defer, distinctUntilChanged, filter, fromEvent, map, merge, Observable, shareReplay } from 'rxjs';

const isFileDrag = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');

/**
 * Emits `true` while files are dragged over the page.
 * dragenter/dragleave bubble from every element the cursor crosses, so a depth
 * counter is used: enter on the new element fires before leave on the old one.
 */
export function createDragObservable(): Observable<boolean> {
  return defer(() => {
    let depth = 0;

    return merge(
      fromEvent<DragEvent>(document, 'dragenter').pipe(
        filter(isFileDrag),
        map(() => ++depth),
      ),
      fromEvent<DragEvent>(document, 'dragleave').pipe(
        filter(isFileDrag),
        map(() => (depth = Math.max(0, depth - 1))),
      ),
      fromEvent<DragEvent>(document, 'drop').pipe(map(() => (depth = 0))),
    ).pipe(map((value) => value > 0));
  }).pipe(distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: true }));
}
