export type TabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export type GroupDocument = {
  tabId: number;
  tokens: string[];
};

export type GroupRecord = {
  groupKey: string;
  chromeGroupId: number;
  centroid: number[];
  docCount: number;
  documents: GroupDocument[];
  label: string;
  color: TabGroupColor;
  createdAt: number;
  updatedAt: number;
};

export type TabState = {
  tabId: number;
  groupKey: string | null;
  lastEmbeddingHash: string;
  pendingReclassify: boolean;
  lastClassifiedAt: number;
};

export type Settings = {
  enabled: boolean;
  threshold: number;
  contentExtractionEnabled: boolean;
  maxDocsPerGroup: number;
  reclassifyMinChars: number;
};

export type StorageSchema = {
  groups: Record<string, GroupRecord>;
  tabs: Record<number, TabState>;
  settings: Settings;
};

export type ExtractedContent = {
  title: string;
  url: string;
  contentSnippet: string;
};
