import { Injectable, signal } from '@angular/core';
import { moveItemInArray } from '@angular/cdk/drag-drop';
import { DefaultSectionOrder, SectionOrderStorageKey } from '../constants/layout.const';
import { HomeSection, HomeSectionOrder } from '../models/layout.model';

const KNOWN_SECTIONS = Object.values(HomeSection);

@Injectable({
  providedIn: 'root',
})
export class LayoutService {
  /** Current home page section order, restored from the last visit. */
  readonly sectionOrder = signal<HomeSectionOrder>(this._read());

  /**
   * Moves one section to where another currently sits. Takes ids rather than
   * indexes because a section that renders nothing is not in the drop list,
   * so the indexes the drag reports do not line up with the stored order.
   */
  moveSection(moved: HomeSection, target: HomeSection): void {
    if (moved === target) return;

    this.sectionOrder.update((order) => {
      const from = order.indexOf(moved);
      const to = order.indexOf(target);

      if (from === -1 || to === -1) return order;

      const next = [...order];
      moveItemInArray(next, from, to);

      return next;
    });

    this._write(this.sectionOrder());
  }

  resetSectionOrder(): void {
    this.sectionOrder.set([...DefaultSectionOrder]);
    this._write(this.sectionOrder());
  }

  /**
   * A stored order can be stale: sections get added or removed between
   * releases, and the value is user-editable in devtools. Rather than trust
   * it, keep the ids it lists that still exist and append anything missing,
   * so a new section always appears instead of silently vanishing.
   */
  private _read(): HomeSectionOrder {
    let stored: unknown;

    try {
      const raw = localStorage.getItem(SectionOrderStorageKey);

      if (!raw) return [...DefaultSectionOrder];

      stored = JSON.parse(raw);
    } catch {
      // Unparseable, or storage is unavailable (private mode, blocked data).
      return [...DefaultSectionOrder];
    }

    if (!Array.isArray(stored)) return [...DefaultSectionOrder];

    const known = stored.filter((id): id is HomeSection => KNOWN_SECTIONS.includes(id as HomeSection));
    const unique = [...new Set(known)];

    return [...unique, ...DefaultSectionOrder.filter((id) => !unique.includes(id))];
  }

  private _write(order: HomeSectionOrder): void {
    try {
      localStorage.setItem(SectionOrderStorageKey, JSON.stringify(order));
    } catch {
      // Persisting is a convenience; the order still applies for this visit.
    }
  }
}
