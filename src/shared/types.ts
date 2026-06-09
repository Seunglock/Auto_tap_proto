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

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type CodeBlock = {
  language?: string;
  code: string;
};

export type VideoContent = {
  videoTitle: string;
  channel?: string;
  description?: string;
};

export type RichContent = {
  summary?: string;
  conversationTurns?: ConversationTurn[];
  codeBlocks?: CodeBlock[];
  video?: VideoContent;
};

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
  diaryEpisodes: Record<string, DiaryEpisode>;
  diaryEntries: Record<string, DiaryEntry>;
  diarySettings: DiarySettings;
};

export type ExtractedContent = {
  title: string;
  url: string;
  contentSnippet: string;
  headings?: string[];
  pageType?: PageType;
  extractionSource?: ExtractionSource;
  extractionConfidence?: number;
  richContent?: RichContent;
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

// ── Diary types (browser history journal) ──────────────────────────────────

export type DiaryCategoryKey = "dev" | "ent" | "news" | "life" | "sens";

export type DiaryEpisodeSource =
  | "classified-tab"
  | "history-backfill"
  | "history-fallback";

export type DiaryDurationSource = "observed" | "estimated";

export type DiaryEpisode = {
  id: string;
  dateKey: string;
  startedAt: number;
  durationMs: number;
  durationSource: DiaryDurationSource;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  richContent?: RichContent;
  pageType?: PageType;
  headings?: string[];
  groupKey: string | null;
  groupLabel: string;
  keywords: string[];
  tokens: string[];
  categoryKey: DiaryCategoryKey;
  isSensitive: boolean;
  source: DiaryEpisodeSource;
  createdAt: number;
  updatedAt: number;
};

export type DiaryFontFamily =
  | "system"
  | "serif"
  | "gothic"
  | "handwriting"
  | "mono";

export type DiaryTextFormat = {
  fontFamily: DiaryFontFamily;
  fontSize: number; // px: 12–24
  textColor: string; // hex e.g. "#3d2459"
};

export type DiaryEntry = {
  dateKey: string;
  summary: string;
  body: string;
  tags: string[];
  sourceEpisodeIds: string[];
  createdAt: number;
  format?: DiaryTextFormat;
  updatedAt: number;
};

export type DiaryGroupSummary = {
  groupKey: string | null;
  label: string;
  count: number;
  keywords: string[];
  categoryKey: DiaryCategoryKey;
};

export type DiaryDomainSummary = {
  domain: string;
  count: number;
};

export type DiaryStats = {
  totalEpisodes: number;
  safeEpisodes: number;
  sensitiveEpisodes: number;
  activeMinutes: number;
};

export type DiaryDay = {
  dateKey: string;
  episodes: DiaryEpisode[];
  topKeywords: string[];
  topGroups: DiaryGroupSummary[];
  topDomains: DiaryDomainSummary[];
  stats: DiaryStats;
  entry: DiaryEntry | null;
};

export type DiaryWeekDay = {
  dateKey: string;
  label: string;
  stats: DiaryStats;
  topGroups: DiaryGroupSummary[];
  topKeywords: string[];
};

export type DiaryWeek = {
  startDateKey: string;
  endDateKey: string;
  days: DiaryWeekDay[];
};

export type DiaryAnalysis = {
  dateKey: string;
  week: DiaryWeek;
  topKeywords: Array<{ keyword: string; count: number }>;
  topGroups: DiaryGroupSummary[];
  recommendations: Array<{ title: string; body: string; tags: string[] }>;
};

export type DiarySettings = {
  collectionEnabled: boolean;
  sensitiveFilterEnabled: boolean;
  backfillDays: number;
  geminiApiKey: string;
};
