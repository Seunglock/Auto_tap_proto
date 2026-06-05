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

export type PageType =
  | "article"
  | "documentation"
  | "search"
  | "ai-chat"
  | "social"
  | "video"
  | "mail"
  | "dashboard"
  | "code"
  | "unknown";

export type ExtractionSource =
  | "site-extractor"
  | "core-content"
  | "metadata-only"
  | "failed";

export type ClassificationReason =
  | "initial"
  | "manual-regroup"
  | "content-change"
  | "url-change";

export type ClassificationOptions = {
  reason?: ClassificationReason;
  allowReassign?: boolean;
  allowUngroup?: boolean;
  force?: boolean;
};

export type GroupDocument = {
  tabId: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  tokens: string[];
  embedding: number[];
  collectedAt: number;
  updatedAt: number;
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
  lastActiveAt: number;
  domains: Record<string, number>;
};

export type TabState = {
  tabId: number;
  groupKey: string | null;
  lastUrl: string;
  lastEmbeddingHash: string;
  pendingReclassify: boolean;
  lastClassifiedAt: number;
  firstSeenAt: number;
  navigationVersion: number;
  urlDirty: boolean;
};

export type Settings = {
  enabled: boolean;
  threshold: number;
  contentExtractionEnabled: boolean;
  maxDocsPerGroup: number;
  reclassifyMinChars: number;
  keepThreshold: number;
  urlChangeReclassifyEnabled: boolean;
  groupMergeEnabled: boolean;
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
  headings?: string[];
  pageType?: PageType;
  extractionSource?: ExtractionSource;
  extractionConfidence?: number;
};

// ── Summary types (for popup display) ──────────────────────────────────────

export type GroupSummary = {
  groupKey: string;
  label: string;
  color: TabGroupColor;
  docCount: number;
  topKeywords: string[];
  topDomains: string[];
  recentTitles: string[];
  updatedAt: number;
};

export type CollectionSummary = {
  totalGroups: number;
  totalDocuments: number;
  lastUpdatedAt: number | null;
  topKeywords: string[];
  groups: GroupSummary[];
};
