import {
  classifyTab,
  pruneStaleChromeGroups,
  removeTabFromGroups,
} from "./classifier";
import { fallbackExtract, requestExtract } from "./content-extractor";
import { shouldClassify } from "./tab-filters";
import {
  deleteTabState,
  getAllGroups,
  getSettings,
  getTabState,
  resetAll,
  updateSettings,
} from "./storage";
import { warmupEmbedder } from "./embedder";
import type {
  AnyMessage,
  GetGroupsResponse,
  GetSettingsResponse,
} from "@/shared/messages";

const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 300;

chrome.runtime.onInstalled.addListener(async () => {
  await pruneStaleChromeGroups();
  warmupEmbedder().catch((err) =>
    console.warn("[auto-tab-group] warmup failed", err),
  );
});

chrome.runtime.onStartup.addListener(() => {
  warmupEmbedder().catch((err) =>
    console.warn("[auto-tab-group] warmup failed", err),
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  scheduleClassification(tabId, tab);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const timer = debounceTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(tabId);
  }
  try {
    await removeTabFromGroups(tabId);
  } catch (err) {
    console.warn("[auto-tab-group] removeTabFromGroups failed", err);
  }
  await deleteTabState(tabId);
});

chrome.tabs.onDetached.addListener(async (tabId) => {
  try {
    await removeTabFromGroups(tabId);
  } catch (err) {
    console.warn("[auto-tab-group] onDetached cleanup failed", err);
  }
  await deleteTabState(tabId);
});

chrome.tabGroups.onRemoved.addListener(async (group) => {
  const groups = await getAllGroups();
  const orphanGroupKeys: string[] = [];
  for (const key of Object.keys(groups)) {
    if (groups[key].chromeGroupId === group.id) {
      orphanGroupKeys.push(key);
    }
  }
  if (orphanGroupKeys.length === 0) return;
  const nextGroups = { ...groups };
  for (const key of orphanGroupKeys) delete nextGroups[key];
  await chrome.storage.local.set({ groups: nextGroups });

  const tabs = await chrome.storage.local.get("tabs");
  const tabStates = (tabs.tabs ?? {}) as Record<number, { groupKey: string | null }>;
  let tabsTouched = false;
  for (const tabId of Object.keys(tabStates)) {
    const state = tabStates[Number(tabId)];
    if (state.groupKey && orphanGroupKeys.includes(state.groupKey)) {
      state.groupKey = null;
      tabsTouched = true;
    }
  }
  if (tabsTouched) {
    await chrome.storage.local.set({ tabs: tabStates });
  }
});

chrome.runtime.onMessage.addListener((message: AnyMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error("[auto-tab-group] message error", err);
    sendResponse({ error: String(err) });
  });
  return true;
});

function scheduleClassification(tabId: number, tab: chrome.tabs.Tab): void {
  const existing = debounceTimers.get(tabId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(tabId);
    void runClassification(tabId, tab);
  }, DEBOUNCE_MS);
  debounceTimers.set(tabId, timer);
}

async function runClassification(
  tabId: number,
  tabHint: chrome.tabs.Tab,
): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!shouldClassify(tab)) return;
  const settings = await getSettings();
  if (!settings.enabled) return;

  const content =
    settings.contentExtractionEnabled
      ? (await requestExtract(tabId)) ?? (await fallbackExtract(tab))
      : await fallbackExtract(tab);

  if (!content.title && !content.contentSnippet) {
    content.title = tab.title ?? tabHint.title ?? "";
  }

  try {
    await classifyTab(tab, content);
  } catch (err) {
    console.error("[auto-tab-group] classify failed", err);
  }
}

async function handleReclassify(
  tabId: number,
  content: { title: string; url: string; contentSnippet: string },
): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  const settings = await getSettings();
  if (!settings.enabled || !settings.contentExtractionEnabled) return;
  const tabState = await getTabState(tabId);
  const allowReassign = !tabState?.groupKey || tabState.pendingReclassify;
  try {
    await classifyTab(tab, content, { allowReassign });
  } catch (err) {
    console.error("[auto-tab-group] reclassify failed", err);
  }
}

async function handleMessage(
  message: AnyMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case "RECLASSIFY": {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number") return { ok: false };
      await handleReclassify(tabId, message.payload);
      return { ok: true };
    }
    case "GET_GROUPS": {
      const groups = await getAllGroups();
      const response: GetGroupsResponse = {
        type: "GET_GROUPS_RESULT",
        groups: Object.values(groups),
      };
      return response;
    }
    case "GET_SETTINGS": {
      const settings = await getSettings();
      const response: GetSettingsResponse = {
        type: "GET_SETTINGS_RESULT",
        settings,
      };
      return response;
    }
    case "UPDATE_SETTINGS": {
      const settings = await updateSettings(message.settings);
      return { ok: true, settings };
    }
    case "REGROUP_ALL": {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        if (!shouldClassify(tab)) continue;
        const content =
          (await requestExtract(tab.id)) ?? (await fallbackExtract(tab));
        try {
          await classifyTab(tab, content, { allowReassign: true });
        } catch (err) {
          console.warn("[auto-tab-group] regroup tab failed", tab.id, err);
        }
      }
      return { ok: true };
    }
    case "RESET_ALL": {
      await resetAll();
      return { ok: true };
    }
    case "UPDATE_GROUP_LABEL": {
      const groups = await getAllGroups();
      const target = groups[message.groupKey];
      if (!target) return { ok: false };
      target.label = message.label;
      await chrome.storage.local.set({ groups });
      try {
        await chrome.tabGroups.update(target.chromeGroupId, {
          title: message.label,
        });
      } catch (err) {
        console.warn("[auto-tab-group] label update failed", err);
      }
      return { ok: true };
    }
    default:
      return { ok: false };
  }
}
