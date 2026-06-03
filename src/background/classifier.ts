import {
  buildPassageText,
  cosineSimilarity,
  embedText,
  hashString,
} from "./embedder";
import {
  findBestMatch,
  makeGroupKey,
  pickColor,
  updateCentroid,
} from "./clustering";
import { computeLabel, tokenize } from "./labeling";
import {
  deleteGroup,
  getAllGroups,
  getSettings,
  getTabState,
  saveGroup,
  saveTabState,
} from "./storage";
import type { ExtractedContent, GroupRecord, TabState } from "@/shared/types";
import { MIN_CONTENT_TOKENS } from "@/shared/constants";
import { isSearchEngineUrl } from "@/shared/site-detection";

const MIN_SEARCH_SNIPPET_CHARS = 80;

export type ClassificationOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "joined"; groupKey: string; chromeGroupId: number }
  | { kind: "created"; groupKey: string; chromeGroupId: number }
  | { kind: "updated-centroid"; groupKey: string };

export async function classifyTab(
  tab: chrome.tabs.Tab,
  content: ExtractedContent,
  options: { allowReassign?: boolean } = {},
): Promise<ClassificationOutcome> {
  if (typeof tab.id !== "number") {
    return { kind: "skipped", reason: "no-tab-id" };
  }
  const settings = await getSettings();
  if (!settings.enabled) return { kind: "skipped", reason: "disabled" };

  const passageText = buildPassageText(
    content.title,
    content.url,
    content.contentSnippet,
  );
  const tokens = tokenize(`${content.title} ${content.contentSnippet}`);
  if (tokens.length < MIN_CONTENT_TOKENS && !options.allowReassign) {
    await markPendingReclassify(tab.id, passageText);
    return { kind: "skipped", reason: "insufficient-content" };
  }

  const isSearchPage = isSearchEngineUrl(content.url);
  const snippetLength = (content.contentSnippet ?? "").length;
  if (
    isSearchPage &&
    snippetLength < MIN_SEARCH_SNIPPET_CHARS &&
    !options.allowReassign
  ) {
    await markPendingReclassify(tab.id, passageText);
    console.log(
      `[auto-tab-group] tab ${tab.id} → DEFERRED (search page, snippet=${snippetLength} chars)`,
    );
    return { kind: "skipped", reason: "search-page-thin-content" };
  }

  const embedding = await embedText(passageText);
  const groups = await getAllGroups();
  const match = findBestMatch(embedding, groups);
  const tabState = await getTabState(tab.id);
  const allowReassign = options.allowReassign ?? !tabState?.groupKey;

  logClassification(
    tab,
    content,
    passageText,
    match,
    embedding,
    groups,
    settings.threshold,
  );

  if (match && match.similarity >= settings.threshold) {
    const target = groups[match.groupKey];
    if (allowReassign && target.chromeGroupId !== tab.groupId) {
      await joinChromeGroup(tab.id, target.chromeGroupId);
    }
    await applyDocumentToGroup(target, tab.id, embedding, tokens, settings);
    await updateLabelIfNeeded(target);
    await persistTabState(tab.id, target.groupKey, passageText, content);
    return target.chromeGroupId === tab.groupId
      ? { kind: "updated-centroid", groupKey: target.groupKey }
      : { kind: "joined", groupKey: target.groupKey, chromeGroupId: target.chromeGroupId };
  }

  if (!allowReassign) {
    return { kind: "skipped", reason: "below-threshold-no-reassign" };
  }

  const created = await createNewGroup(tab.id, embedding, tokens);
  await persistTabState(tab.id, created.groupKey, passageText, content);
  return {
    kind: "created",
    groupKey: created.groupKey,
    chromeGroupId: created.chromeGroupId,
  };
}

function logClassification(
  tab: chrome.tabs.Tab,
  content: ExtractedContent,
  passageText: string,
  match: { groupKey: string; similarity: number } | null,
  embedding: number[],
  groups: Record<string, GroupRecord>,
  threshold: number,
): void {
  const decision =
    match && match.similarity >= threshold
      ? `JOIN "${groups[match.groupKey].label}" (${match.similarity.toFixed(3)})`
      : `NEW (best=${match ? match.similarity.toFixed(3) : "n/a"} < ${threshold})`;
  console.groupCollapsed(`[auto-tab-group] tab ${tab.id} → ${decision}`);
  console.log("title:", content.title);
  console.log("url:", content.url);
  console.log("snippet(200):", content.contentSnippet?.slice(0, 200));
  console.log("passage(200):", passageText.slice(0, 200));
  const entries = Object.entries(groups)
    .map(([key, g]) => ({
      key,
      label: g.label,
      sim: cosineSimilarity(embedding, g.centroid),
    }))
    .sort((a, b) => b.sim - a.sim);
  if (entries.length > 0) {
    console.log("similarities (top → bottom):");
    for (const e of entries) {
      const flag = e.sim >= threshold ? "✓" : " ";
      console.log(`  ${flag} ${e.sim.toFixed(3)}  ${e.label}  [${e.key}]`);
    }
  }
  console.groupEnd();
}

async function applyDocumentToGroup(
  group: GroupRecord,
  tabId: number,
  embedding: number[],
  tokens: string[],
  settings: { maxDocsPerGroup: number },
): Promise<void> {
  group.centroid = updateCentroid(group.centroid, group.docCount, embedding);
  group.docCount += 1;
  const existingIdx = group.documents.findIndex((d) => d.tabId === tabId);
  if (existingIdx >= 0) {
    group.documents[existingIdx] = { tabId, tokens };
  } else {
    group.documents.push({ tabId, tokens });
    if (group.documents.length > settings.maxDocsPerGroup) {
      group.documents.shift();
    }
  }
  group.updatedAt = Date.now();
  await saveGroup(group);
}

async function updateLabelIfNeeded(group: GroupRecord): Promise<void> {
  const allGroups = await getAllGroups();
  const newLabel = computeLabel(group, allGroups);
  if (newLabel && newLabel !== group.label) {
    group.label = newLabel;
    await saveGroup(group);
    try {
      await chrome.tabGroups.update(group.chromeGroupId, {
        title: newLabel,
      });
    } catch (err) {
      console.warn("[auto-tab-group] update label failed", err);
    }
  }
}

async function createNewGroup(
  tabId: number,
  embedding: number[],
  tokens: string[],
): Promise<GroupRecord> {
  const groupKey = makeGroupKey();
  const chromeGroupId = await chrome.tabs.group({ tabIds: [tabId] });

  const tempGroup: GroupRecord = {
    groupKey,
    chromeGroupId,
    centroid: embedding.slice(),
    docCount: 1,
    documents: [{ tabId, tokens }],
    label: tokens[0] ?? "새 그룹",
    color: "blue",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const allGroups = await getAllGroups();
  const label = computeLabel(tempGroup, { ...allGroups, [groupKey]: tempGroup });
  tempGroup.label = label || tempGroup.label;
  tempGroup.color = pickColor(tempGroup.label);
  await saveGroup(tempGroup);
  try {
    await chrome.tabGroups.update(chromeGroupId, {
      title: tempGroup.label,
      color: tempGroup.color,
    });
  } catch (err) {
    console.warn("[auto-tab-group] create label failed", err);
  }
  return tempGroup;
}

async function joinChromeGroup(
  tabId: number,
  chromeGroupId: number,
): Promise<void> {
  try {
    await chrome.tabs.group({ tabIds: [tabId], groupId: chromeGroupId });
  } catch (err) {
    console.warn("[auto-tab-group] join failed", err);
  }
}

async function persistTabState(
  tabId: number,
  groupKey: string,
  passageText: string,
  content: ExtractedContent,
): Promise<void> {
  const settings = await getSettings();
  const isShortContent =
    (content.contentSnippet?.length ?? 0) < settings.reclassifyMinChars;
  const state: TabState = {
    tabId,
    groupKey,
    lastEmbeddingHash: hashString(passageText),
    pendingReclassify: isShortContent,
    lastClassifiedAt: Date.now(),
  };
  await saveTabState(state);
}

async function markPendingReclassify(
  tabId: number,
  passageText: string,
): Promise<void> {
  const existing = await getTabState(tabId);
  const state: TabState = {
    tabId,
    groupKey: existing?.groupKey ?? null,
    lastEmbeddingHash: hashString(passageText),
    pendingReclassify: true,
    lastClassifiedAt: Date.now(),
  };
  await saveTabState(state);
}

export async function pruneStaleChromeGroups(): Promise<void> {
  const groups = await getAllGroups();
  for (const groupKey of Object.keys(groups)) {
    const group = groups[groupKey];
    try {
      await chrome.tabGroups.get(group.chromeGroupId);
    } catch {
      await deleteGroup(groupKey);
    }
  }
}

export async function removeTabFromGroups(tabId: number): Promise<void> {
  const groups = await getAllGroups();
  let touched = false;
  for (const groupKey of Object.keys(groups)) {
    const group = groups[groupKey];
    const idx = group.documents.findIndex((d) => d.tabId === tabId);
    if (idx === -1) continue;
    group.documents.splice(idx, 1);
    group.docCount = Math.max(0, group.docCount - 1);
    group.updatedAt = Date.now();
    touched = true;

    if (group.documents.length === 0) {
      await deleteGroup(groupKey);
      try {
        await chrome.tabGroups.update(group.chromeGroupId, { collapsed: false });
      } catch {
        // chrome group already gone
      }
      continue;
    }

    await saveGroup(group);
    await updateLabelIfNeeded(group);
  }
  if (touched) {
    await rebalanceLabelsAcrossGroups();
  }
}

async function rebalanceLabelsAcrossGroups(): Promise<void> {
  const groups = await getAllGroups();
  for (const groupKey of Object.keys(groups)) {
    await updateLabelIfNeeded(groups[groupKey]);
  }
}
