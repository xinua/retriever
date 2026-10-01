export interface ChangelogModel {
  bugfixes: string[];
  features: string[];
  improvements: string[];
  other: string[];
  images?: string[];
  developerMessage?: string;
}

export interface ChangelogHistoryModel {
  version: string;
  releaseDate: string;
  changelog: ChangelogModel;
}

export interface VersionModel {
  version: string;
  releaseDate: string;
  changelog: ChangelogHistoryModel[];
  enabled: boolean;
  current: string;
  latest: string;
  updateAvailable: boolean;
  checkedAt: string;
  nextCheckAt: string;
  error: string | null;
}
