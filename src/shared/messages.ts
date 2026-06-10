import type {
  CollectionSummary,
  DiaryAnalysis,
  DiaryDay,
  DiaryEntry,
  DiarySettings,
  DiaryTextFormat,
  DiaryWeek,
  ExtractedContent,
  GroupRecord,
  Settings,
} from "./types";

export type ExtractRequest = {
  type: "EXTRACT";
};

export type ExtractResponse = {
  type: "EXTRACT_RESULT";
  payload: ExtractedContent;
};

export type ReclassifyRequest = {
  type: "RECLASSIFY";
  payload: ExtractedContent;
};

export type GetGroupsRequest = {
  type: "GET_GROUPS";
};

export type GetGroupsResponse = {
  type: "GET_GROUPS_RESULT";
  groups: GroupRecord[];
};

export type RegroupAllRequest = {
  type: "REGROUP_ALL";
};

export type ResetAllRequest = {
  type: "RESET_ALL";
};

export type GetSettingsRequest = {
  type: "GET_SETTINGS";
};

export type GetSettingsResponse = {
  type: "GET_SETTINGS_RESULT";
  settings: Settings;
};

export type UpdateSettingsRequest = {
  type: "UPDATE_SETTINGS";
  settings: Partial<Settings>;
};

export type UpdateGroupLabelRequest = {
  type: "UPDATE_GROUP_LABEL";
  groupKey: string;
  label: string;
};

export type GetSummaryRequest = {
  type: "GET_SUMMARY";
};

export type GetSummaryResponse = {
  type: "GET_SUMMARY_RESULT";
  summary: CollectionSummary;
};

export type GetDiaryDayRequest = {
  type: "GET_DIARY_DAY";
  dateKey?: string;
};

export type GetDiaryDayResponse = {
  type: "GET_DIARY_DAY_RESULT";
  day: DiaryDay;
};

export type GetDiaryWeekRequest = {
  type: "GET_DIARY_WEEK";
  dateKey?: string;
};

export type GetDiaryWeekResponse = {
  type: "GET_DIARY_WEEK_RESULT";
  week: DiaryWeek;
};

export type GetDiaryAnalysisRequest = {
  type: "GET_DIARY_ANALYSIS";
  dateKey?: string;
};

export type GetDiaryAnalysisResponse = {
  type: "GET_DIARY_ANALYSIS_RESULT";
  analysis: DiaryAnalysis;
};

export type GenerateDiaryEntryRequest = {
  type: "GENERATE_DIARY_ENTRY";
  dateKey?: string;
};

export type GenerateDiaryEntryResponse = {
  type: "GENERATE_DIARY_ENTRY_RESULT";
  entry: DiaryEntry;
};

export type BackfillHistoryRequest = {
  type: "BACKFILL_HISTORY";
  days?: number;
};

export type BackfillHistoryResponse = {
  type: "BACKFILL_HISTORY_RESULT";
  importedCount: number;
};

export type GetDiarySettingsRequest = {
  type: "GET_DIARY_SETTINGS";
};

export type GetDiarySettingsResponse = {
  type: "GET_DIARY_SETTINGS_RESULT";
  settings: DiarySettings;
};

export type UpdateDiarySettingsRequest = {
  type: "UPDATE_DIARY_SETTINGS";
  settings: Partial<DiarySettings>;
};

export type SaveDiaryEntryRequest = {
  type: "SAVE_DIARY_ENTRY";
  dateKey: string;
  patch: {
    summary?: string;
    body?: string;
    bodyHtml?: string;
    tags?: string[];
    format?: DiaryTextFormat;
  };
};

export type SaveDiaryEntryResponse = {
  type: "SAVE_DIARY_ENTRY_RESULT";
  entry: DiaryEntry;
};

export type AnyMessage =
  | ExtractRequest
  | ReclassifyRequest
  | GetGroupsRequest
  | RegroupAllRequest
  | ResetAllRequest
  | GetSettingsRequest
  | UpdateSettingsRequest
  | UpdateGroupLabelRequest
  | GetSummaryRequest
  | GetDiaryDayRequest
  | GetDiaryWeekRequest
  | GetDiaryAnalysisRequest
  | GenerateDiaryEntryRequest
  | BackfillHistoryRequest
  | GetDiarySettingsRequest
  | UpdateDiarySettingsRequest
  | SaveDiaryEntryRequest;
