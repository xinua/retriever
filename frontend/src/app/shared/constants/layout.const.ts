import { HomeSection, HomeSectionOrder } from '../models/layout.model';

/** Order the page falls back to when nothing valid is stored. */
export const DefaultSectionOrder: HomeSectionOrder = [HomeSection.SUBSCRIPTIONS, HomeSection.DOWNLOADS];

export const SectionOrderStorageKey = 'retriever.home-section-order';
