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
  saveTabState,
  updateSettings,
} from "./storage";
import { warmupEmbedder } from "./embedder";
import { buildCollectionSummary } from "./summarizer";
import {
  backfillHistory,
  generateDiaryEntry,
  getDiaryAnalysis,
  getDiaryDay,
  getDiarySettings,
  getDiaryWeek,
  updateDiarySettings,
  saveDiaryEntry,
} from "./diary";
import type {
  AnyMessage,
  BackfillHistoryResponse,
  GenerateDiaryEntryResponse,
  GetDiaryAnalysisResponse,
  GetDiaryDayResponse,
  GetDiarySettingsResponse,
  GetDiaryWeekResponse,
  GetGroupsResponse,
  GetSettingsResponse,
  GetSummaryResponse,
  SaveDiaryEntryResponse,
} from "@/shared/messages";
import type { ClassificationOptions, TabState } from "@/shared/types";

const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 300;
const URL_CHANGE_DEBOUNCE_MS = 1000;

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
  // When the URL changes, mark the tab dirty so the next "complete" event
  // triggers a forced reclassification (even for already-grouped tabs).
  if (changeInfo.url) {
    void handleUrlDirty(tabId, changeInfo.url, tab);
  }

  if (changeInfo.status === "complete") {
    scheduleClassification(tabId, tab);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void handleWebNavigationUrlChange(details);
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  void handleWebNavigationUrlChange(details);
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
  const tabStates = (tabs.tabs ?? {}) as Record<
    number,
    { groupKey: string | null }
  >;
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

chrome.runtime.onMessage.addListener(
  (message: AnyMessage, sender, sendResponse) => {
    void handleMessage(message, sender)
      .then(sendResponse)
      .catch((err) => {
        console.error("[auto-tab-group] message error", err);
        sendResponse({ error: String(err) });
      });
    return true;
  },
);

// ── URL dirty tracking ────────────────────────────────────────────────────────

async function handleWebNavigationUrlChange(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  if (details.frameId !== 0) return;

  const markedDirty = await handleUrlDirty(details.tabId, details.url);
  if (!markedDirty) return;

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(details.tabId);
  } catch {
    return;
  }
  scheduleClassification(details.tabId, tab, URL_CHANGE_DEBOUNCE_MS);
}

async function handleUrlDirty(
  tabId: number,
  newUrl: string,
  tabHint?: chrome.tabs.Tab,
): Promise<boolean> {
  const tabState = await getTabState(tabId);
  const state = tabState?.groupKey
    ? tabState
    : await restoreGroupedTabState(tabId, tabHint);

  // Only mark dirty if the tab belongs to an auto-managed group.
  if (!state?.groupKey) return false;
  // Skip if URL hasn't actually changed
  if (state.lastUrl === newUrl) return false;

  await saveTabState({
    ...state,
    urlDirty: true,
    navigationVersion: (state.navigationVersion ?? 0) + 1,
  });
  return true;
}

async function restoreGroupedTabState(
  tabId: number,
  tabHint?: chrome.tabs.Tab,
): Promise<TabState | null> {
  let tab = tabHint;
  if (!tab) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  if (
    typeof tab.groupId !== "number" ||
    tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
  ) {
    return null;
  }

  const groups = await getAllGroups();
  const group = Object.values(groups).find(
    (candidate) => candidate.chromeGroupId === tab.groupId,
  );
  if (!group) return null;

  const now = Date.now();
  return {
    tabId,
    groupKey: group.groupKey,
    lastUrl: "",
    lastEmbeddingHash: "",
    pendingReclassify: false,
    lastClassifiedAt: now,
    firstSeenAt: now,
    navigationVersion: 0,
    urlDirty: false,
  };
}

// ── Classification scheduling ─────────────────────────────────────────────────

function scheduleClassification(
  tabId: number,
  tab: chrome.tabs.Tab,
  delayMs = DEBOUNCE_MS,
): void {
  const existing = debounceTimers.get(tabId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(tabId);
    void runClassification(tabId, tab);
  }, delayMs);
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

  const tabState = await getTabState(tabId);
  const isUrlChange = tabState?.urlDirty === true;
  const settings = await getSettings();

  if (!settings.enabled) return;

  // For URL changes on already-grouped tabs: bypass the "already-grouped" filter.
  // For all other cases: apply the normal filter.
  if (!isUrlChange && !shouldClassify(tab)) return;

  // If this is a URL change but the URL ended up being the same, just clear dirty.
  if (isUrlChange && tabState?.lastUrl === tab.url) {
    await saveTabState({ ...tabState, urlDirty: false });
    return;
  }

  const content = settings.contentExtractionEnabled
    ? ((await requestExtract(tabId)) ?? (await fallbackExtract(tab)))
    : await fallbackExtract(tab);

  if (!content.title && !content.contentSnippet) {
    content.title = tab.title ?? tabHint.title ?? "";
  }

  const hasCurrentGroup = !!tabState?.groupKey;
  const classifyOptions: ClassificationOptions = isUrlChange
    ? {
        reason: "url-change",
        allowReassign: true,
        allowUngroup: settings.urlChangeReclassifyEnabled,
        force: false,
      }
    : {
        reason: "initial",
        allowReassign: !hasCurrentGroup,
      };

  try {
    await classifyTab(tab, content, classifyOptions);
  } catch (err) {
    console.error("[auto-tab-group] classify failed", err);
  }
}

// ── RECLASSIFY handler (content-change from MutationObserver) ─────────────────

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
    await classifyTab(tab, content, {
      reason: "content-change",
      allowReassign,
    });
  } catch (err) {
    console.error("[auto-tab-group] reclassify failed", err);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

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
    case "GET_SUMMARY": {
      const groups = await getAllGroups();
      const summary = buildCollectionSummary(groups);
      const response: GetSummaryResponse = {
        type: "GET_SUMMARY_RESULT",
        summary,
      };
      return response;
    }
    case "GET_DIARY_DAY": {
      const day = await getDiaryDay(message.dateKey);
      const response: GetDiaryDayResponse = {
        type: "GET_DIARY_DAY_RESULT",
        day,
      };
      return response;
    }
    case "GET_DIARY_WEEK": {
      const week = await getDiaryWeek(message.dateKey);
      const response: GetDiaryWeekResponse = {
        type: "GET_DIARY_WEEK_RESULT",
        week,
      };
      return response;
    }
    case "GET_DIARY_ANALYSIS": {
      const analysis = await getDiaryAnalysis(message.dateKey);
      const response: GetDiaryAnalysisResponse = {
        type: "GET_DIARY_ANALYSIS_RESULT",
        analysis,
      };
      return response;
    }
    case "GENERATE_DIARY_ENTRY": {
      const entry = await generateDiaryEntry(message.dateKey);
      const response: GenerateDiaryEntryResponse = {
        type: "GENERATE_DIARY_ENTRY_RESULT",
        entry,
      };
      return response;
    }
    case "BACKFILL_HISTORY": {
      const importedCount = await backfillHistory(message.days);
      const response: BackfillHistoryResponse = {
        type: "BACKFILL_HISTORY_RESULT",
        importedCount,
      };
      return response;
    }
    case "GET_DIARY_SETTINGS": {
      const settings = await getDiarySettings();
      const response: GetDiarySettingsResponse = {
        type: "GET_DIARY_SETTINGS_RESULT",
        settings,
      };
      return response;
    }
    case "UPDATE_DIARY_SETTINGS": {
      const settings = await updateDiarySettings(message.settings);
      return { ok: true, settings };
    }
    case "SAVE_DIARY_ENTRY": {
      const entry = await saveDiaryEntry(message.dateKey, message.patch);
      const response: SaveDiaryEntryResponse = {
        type: "SAVE_DIARY_ENTRY_RESULT",
        entry,
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
          await classifyTab(tab, content, {
            reason: "manual-regroup",
            allowReassign: true,
          });
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
