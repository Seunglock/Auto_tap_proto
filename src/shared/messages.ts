import type { ExtractedContent, GroupRecord, Settings } from "./types";

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

export type AnyMessage =
  | ExtractRequest
  | ReclassifyRequest
  | GetGroupsRequest
  | RegroupAllRequest
  | ResetAllRequest
  | GetSettingsRequest
  | UpdateSettingsRequest
  | UpdateGroupLabelRequest;
