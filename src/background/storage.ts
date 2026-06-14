import type {
  GroupDocument,
  GroupRecord,
  PageType,
  RichContent,
  Settings,
  StorageSchema,
  TabGroupColor,
  TabState,
} from "@/shared/types";
import { DEFAULT_SETTINGS } from "@/shared/constants";

const KEYS = {
  groups: "groups",
  tabs: "tabs",
  settings: "settings",
} as const;

async function getRaw<K extends keyof StorageSchema>(
  key: K,
): Promise<StorageSchema[K] | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as StorageSchema[K] | undefined;
}

function normalizeGroupDocument(raw: Record<string, unknown>): GroupDocument {
  return {
    tabId: (raw.tabId as number) ?? 0,
    title: (raw.title as string) ?? "",
    url: (raw.url as string) ?? "",
    domain: (raw.domain as string) ?? "",
    snippet: (raw.snippet as string) ?? "",
    pageType: raw.pageType as PageType | undefined,
    headings: (raw.headings as string[] | undefined) ?? undefined,
    richContent: raw.richContent as RichContent | undefined,
    tokens: (raw.tokens as string[]) ?? [],
    embedding: (raw.embedding as number[]) ?? [],
    collectedAt: (raw.collectedAt as number) ?? 0,
    updatedAt: (raw.updatedAt as number) ?? 0,
  };
}

function normalizeGroupRecord(raw: Record<string, unknown>): GroupRecord {
  const updatedAt = (raw.updatedAt as number) ?? Date.now();
  return {
    groupKey: (raw.groupKey as string) ?? "",
    chromeGroupId: (raw.chromeGroupId as number) ?? -1,
    centroid: (raw.centroid as number[]) ?? [],
    docCount: (raw.docCount as number) ?? 0,
    documents: ((raw.documents as unknown[]) ?? []).map((d) =>
      normalizeGroupDocument(d as Record<string, unknown>),
    ),
    label: (raw.label as string) ?? "",
    color: (raw.color as TabGroupColor) ?? "blue",
    createdAt: (raw.createdAt as number) ?? updatedAt,
    updatedAt,
    lastActiveAt: (raw.lastActiveAt as number) ?? updatedAt,
    domains: (raw.domains as Record<string, number>) ?? {},
  };
}

function normalizeTabState(raw: Record<string, unknown>): TabState {
  const lastClassifiedAt = (raw.lastClassifiedAt as number) ?? Date.now();
  return {
    tabId: (raw.tabId as number) ?? 0,
    groupKey: (raw.groupKey as string | null) ?? null,
    lastUrl: (raw.lastUrl as string) ?? "",
    lastEmbeddingHash: (raw.lastEmbeddingHash as string) ?? "",
    pendingReclassify: (raw.pendingReclassify as boolean) ?? false,
    lastClassifiedAt,
    firstSeenAt: (raw.firstSeenAt as number) ?? lastClassifiedAt,
    navigationVersion: (raw.navigationVersion as number) ?? 0,
    urlDirty: (raw.urlDirty as boolean) ?? false,
  };
}

export async function getAllGroups(): Promise<Record<string, GroupRecord>> {
  const raw = (await getRaw(KEYS.groups)) ?? {};
  const normalized: Record<string, GroupRecord> = {};
  for (const key of Object.keys(raw)) {
    normalized[key] = normalizeGroupRecord(raw[key] as Record<string, unknown>);
  }
  return normalized;
}

export async function getGroup(
  groupKey: string,
): Promise<GroupRecord | undefined> {
  const groups = await getAllGroups();
  return groups[groupKey];
}

export async function saveGroup(group: GroupRecord): Promise<void> {
  const groups = await getAllGroups();
  groups[group.groupKey] = group;
  await chrome.storage.local.set({ [KEYS.groups]: groups });
}

export async function deleteGroup(groupKey: string): Promise<void> {
  const groups = await getAllGroups();
  delete groups[groupKey];
  await chrome.storage.local.set({ [KEYS.groups]: groups });
}

export async function getAllTabStates(): Promise<Record<number, TabState>> {
  const raw = (await getRaw(KEYS.tabs)) ?? ({} as Record<string, unknown>);
  const normalized: Record<number, TabState> = {};
  for (const key of Object.keys(raw)) {
    normalized[Number(key)] = normalizeTabState(
      (raw as Record<string, unknown>)[key] as Record<string, unknown>,
    );
  }
  return normalized;
}

export async function getTabState(
  tabId: number,
): Promise<TabState | undefined> {
  const tabs = await getAllTabStates();
  return tabs[tabId];
}

export async function saveTabState(state: TabState): Promise<void> {
  const tabs = await getAllTabStates();
  tabs[state.tabId] = state;
  await chrome.storage.local.set({ [KEYS.tabs]: tabs });
}

export async function deleteTabState(tabId: number): Promise<void> {
  const tabs = await getAllTabStates();
  delete tabs[tabId];
  await chrome.storage.local.set({ [KEYS.tabs]: tabs });
}

export async function getSettings(): Promise<Settings> {
  const stored = await getRaw(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function resetAll(): Promise<void> {
  await chrome.storage.local.clear();
}
