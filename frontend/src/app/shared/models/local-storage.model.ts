import { PaginatorModel } from './common.model';
import { HomeSectionOrder } from './layout.model';
import { ManualDownloadModel } from './main-form.model';
import { UiConfig } from './ui-config.model';

export interface LocalStorageModel {
  uiConfig: UiConfig;
  paginator: PaginatorModel;
  manualDownloadForm: ManualDownloadModel;
  sectionOrder: HomeSectionOrder;
  rememberChoise: boolean;
  /** The latest release the user has already been told about. */
  notifiedVersion: string | null;
}

export type LocalStorageKey = keyof LocalStorageModel;
