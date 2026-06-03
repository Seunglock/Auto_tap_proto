import type {
  GroupRecord,
  Settings,
  StorageSchema,
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

export async function getAllGroups(): Promise<Record<string, GroupRecord>> {
  return (await getRaw(KEYS.groups)) ?? {};
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
  return (await getRaw(KEYS.tabs)) ?? {};
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

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function resetAll(): Promise<void> {
  await chrome.storage.local.clear();
}
