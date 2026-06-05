import { buildPassageText, embedText, hashString } from "./embedder";
import {
  makeGroupKey,
  pickColor,
  recomputeCentroid,
  updateCentroid,
} from "./clustering";
import { computeLabel, tokenize } from "./labeling";
import { scoreGroups } from "./scoring";
import type { GroupScore } from "./scoring";
import { decideReclassification } from "./reclassification";
import type { ReclassifyDecision } from "./reclassification";
import {
  deleteGroup,
  getAllTabStates,
  getAllGroups,
  getSettings,
  getTabState,
  saveGroup,
  saveTabState,
} from "./storage";
import type {
  ClassificationOptions,
  ExtractedContent,
  GroupDocument,
  GroupRecord,
  Settings,
  TabState,
} from "@/shared/types";
import { MIN_CONTENT_TOKENS } from "@/shared/constants";
import { isSearchEngineUrl } from "@/shared/site-detection";

const MIN_SEARCH_SNIPPET_CHARS = 80;
const GROUP_MERGE_MIN_SEMANTIC = 0.85;
const GROUP_MERGE_MAX_SEMANTIC_GAP = 0.08;

export type ClassificationOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "joined"; groupKey: string; chromeGroupId: number }
  | { kind: "created"; groupKey: string; chromeGroupId: number }
  | { kind: "updated-centroid"; groupKey: string }
  | { kind: "ungrouped"; fromGroupKey: string };

export async function classifyTab(
  tab: chrome.tabs.Tab,
  content: ExtractedContent,
  options: ClassificationOptions = {},
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
    content.headings,
  );
  const tokens = tokenize(`${content.title} ${content.contentSnippet}`);

  if (tokens.length < MIN_CONTENT_TOKENS && !options.force) {
    await markPendingReclassify(tab.id, passageText, content);
    return { kind: "skipped", reason: "insufficient-content" };
  }

  // Skip if content hash unchanged (avoids redundant embedding)
  const tabState = await getTabState(tab.id);
  const newHash = hashString(passageText);
  if (
    !options.force &&
    options.reason !== "url-change" &&
    tabState?.lastEmbeddingHash === newHash &&
    tabState?.groupKey
  ) {
    return { kind: "skipped", reason: "no-content-change" };
  }

  const isSearchPage = isSearchEngineUrl(content.url);
  const snippetLength = (content.contentSnippet ?? "").length;
  if (
    isSearchPage &&
    snippetLength < MIN_SEARCH_SNIPPET_CHARS &&
    !options.force
  ) {
    await markPendingReclassify(tab.id, passageText, content);
    return { kind: "skipped", reason: "search-page-thin-content" };
  }

  const embedding = await embedText(passageText);
  const groups = await getAllGroups();
  const scores = scoreGroups(embedding, content, groups);

  const currentGroupKey = tabState?.groupKey ?? null;
  const allowReassign = options.allowReassign ?? !currentGroupKey;

  logClassification(
    tab,
    content,
    passageText,
    scores,
    groups,
    settings.threshold,
  );

  // ── URL-change: hysteresis decision ──────────────────────────────────────
  if (options.reason === "url-change" && currentGroupKey) {
    const decision = decideReclassification(
      currentGroupKey,
      scores,
      groups,
      settings,
    );
    return applyDecision(
      tab,
      decision,
      scores,
      embedding,
      tokens,
      content,
      passageText,
      settings,
    );
  }

  // ── Normal path ───────────────────────────────────────────────────────────
  const bestMatch = scores[0] ?? null;

  if (bestMatch && bestMatch.total >= settings.threshold) {
    const target = groups[bestMatch.groupKey];
    if (allowReassign && target.chromeGroupId !== tab.groupId) {
      await joinChromeGroup(tab.id, target.chromeGroupId);
    }
    await applyDocumentToGroup(
      target,
      tab.id,
      embedding,
      tokens,
      content,
      settings,
    );
    await updateLabelIfNeeded(target);
    await persistTabState(tab.id, target.groupKey, passageText, content, {
      urlDirty: false,
    });
    await maybeMergeSimilarGroups(scores, settings);
    return target.chromeGroupId === tab.groupId
      ? { kind: "updated-centroid", groupKey: target.groupKey }
      : {
          kind: "joined",
          groupKey: target.groupKey,
          chromeGroupId: target.chromeGroupId,
        };
  }

  if (!allowReassign) {
    return { kind: "skipped", reason: "below-threshold-no-reassign" };
  }

  const created = await createNewGroup(tab.id, embedding, tokens, content);
  await persistTabState(tab.id, created.groupKey, passageText, content, {
    urlDirty: false,
  });
  return {
    kind: "created",
    groupKey: created.groupKey,
    chromeGroupId: created.chromeGroupId,
  };
}

// ── Decision applier ─────────────────────────────────────────────────────────

async function applyDecision(
  tab: chrome.tabs.Tab,
  decision: ReclassifyDecision,
  scores: GroupScore[],
  embedding: number[],
  tokens: string[],
  content: ExtractedContent,
  passageText: string,
  settings: Settings,
): Promise<ClassificationOutcome> {
  const groups = await getAllGroups();

  switch (decision.action) {
    case "keep": {
      const group = groups[decision.groupKey];
      if (!group) return { kind: "skipped", reason: "group-gone" };
      await applyDocumentToGroup(
        group,
        tab.id!,
        embedding,
        tokens,
        content,
        settings,
      );
      await updateLabelIfNeeded(group);
      await persistTabState(tab.id!, decision.groupKey, passageText, content, {
        urlDirty: false,
      });
      await maybeMergeSimilarGroups(scores, settings);
      return { kind: "updated-centroid", groupKey: decision.groupKey };
    }

    case "move": {
      const target = groups[decision.toGroupKey];
      if (!target) return { kind: "skipped", reason: "target-group-gone" };
      await removeTabFromGroup(tab.id!, decision.fromGroupKey);
      await joinChromeGroup(tab.id!, target.chromeGroupId);
      const freshGroups = await getAllGroups();
      const freshTarget = freshGroups[decision.toGroupKey];
      if (!freshTarget)
        return { kind: "skipped", reason: "target-group-gone-after-remove" };
      await applyDocumentToGroup(
        freshTarget,
        tab.id!,
        embedding,
        tokens,
        content,
        settings,
      );
      await updateLabelIfNeeded(freshTarget);
      await persistTabState(
        tab.id!,
        decision.toGroupKey,
        passageText,
        content,
        { urlDirty: false },
      );
      await maybeMergeSimilarGroups(scores, settings);
      return {
        kind: "joined",
        groupKey: decision.toGroupKey,
        chromeGroupId: target.chromeGroupId,
      };
    }

    case "ungroup": {
      await removeTabFromGroup(tab.id!, decision.fromGroupKey);
      try {
        await chrome.tabs.ungroup([tab.id!]);
      } catch (err) {
        console.warn("[auto-tab-group] ungroup failed", err);
      }
      await persistTabState(tab.id!, null, passageText, content, {
        urlDirty: false,
      });
      return { kind: "ungrouped", fromGroupKey: decision.fromGroupKey };
    }

    case "create-new": {
      if (decision.fromGroupKey) {
        await removeTabFromGroup(tab.id!, decision.fromGroupKey);
      }
      const created = await createNewGroup(tab.id!, embedding, tokens, content);
      await persistTabState(tab.id!, created.groupKey, passageText, content, {
        urlDirty: false,
      });
      return {
        kind: "created",
        groupKey: created.groupKey,
        chromeGroupId: created.chromeGroupId,
      };
    }

    default:
      return { kind: "skipped", reason: "deferred" };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function logClassification(
  tab: chrome.tabs.Tab,
  content: ExtractedContent,
  passageText: string,
  scores: GroupScore[],
  groups: Record<string, GroupRecord>,
  threshold: number,
): void {
  const best = scores[0];
  const decision =
    best && best.total >= threshold
      ? `JOIN "${groups[best.groupKey]?.label}" (total=${best.total.toFixed(3)}, sem=${best.semantic.toFixed(3)})`
      : `NEW (best=${best ? best.total.toFixed(3) : "n/a"} < ${threshold})`;

  console.groupCollapsed(`[auto-tab-group] tab ${tab.id} → ${decision}`);
  console.log("title:", content.title);
  console.log("url:", content.url);
  console.log("snippet(200):", content.contentSnippet?.slice(0, 200));
  console.log("passage(200):", passageText.slice(0, 200));
  if (scores.length > 0) {
    console.log("scores:");
    for (const s of scores) {
      const flag = s.total >= threshold ? "✓" : " ";
      console.log(
        `  ${flag} total=${s.total.toFixed(3)} sem=${s.semantic.toFixed(3)} dom=${s.domain.toFixed(3)} tmp=${s.temporal.toFixed(3)}  ${groups[s.groupKey]?.label ?? s.groupKey}`,
      );
    }
  }
  console.groupEnd();
}

async function applyDocumentToGroup(
  group: GroupRecord,
  tabId: number,
  embedding: number[],
  tokens: string[],
  content: ExtractedContent,
  settings: { maxDocsPerGroup: number },
): Promise<void> {
  group.centroid = updateCentroid(group.centroid, group.docCount, embedding);
  group.docCount += 1;

  const domain = extractDomainFromUrl(content.url);
  const newDoc: GroupDocument = {
    tabId,
    title: content.title ?? "",
    url: content.url ?? "",
    domain,
    snippet: (content.contentSnippet ?? "").slice(0, 300),
    tokens,
    embedding: embedding.slice(),
    collectedAt: Date.now(),
    updatedAt: Date.now(),
  };

  const existingIdx = group.documents.findIndex((d) => d.tabId === tabId);
  if (existingIdx >= 0) {
    group.documents[existingIdx] = newDoc;
  } else {
    group.documents.push(newDoc);
    if (group.documents.length > settings.maxDocsPerGroup) {
      group.documents.shift();
    }
  }

  if (domain) {
    group.domains[domain] = (group.domains[domain] ?? 0) + 1;
  }
  group.lastActiveAt = Date.now();
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
      await chrome.tabGroups.update(group.chromeGroupId, { title: newLabel });
    } catch (err) {
      console.warn("[auto-tab-group] update label failed", err);
    }
  }
}

type MergeCandidate = {
  targetKey: string;
  sourceKey: string;
  targetSemantic: number;
  sourceSemantic: number;
  semanticGap: number;
};

async function maybeMergeSimilarGroups(
  scores: GroupScore[],
  settings: Settings,
): Promise<void> {
  if (!settings.groupMergeEnabled) return;

  const candidate = pickMergeCandidate(scores);
  if (!candidate) return;

  try {
    await mergeGroups(candidate, settings);
  } catch (err) {
    console.warn("[auto-tab-group] merge similar groups failed", err);
  }
}

function pickMergeCandidate(scores: GroupScore[]): MergeCandidate | null {
  const [top, second] = scores;
  if (!top || !second) return null;
  if (top.groupKey === second.groupKey) return null;
  if (
    top.semantic < GROUP_MERGE_MIN_SEMANTIC ||
    second.semantic < GROUP_MERGE_MIN_SEMANTIC
  ) {
    return null;
  }

  const semanticGap = Math.abs(top.semantic - second.semantic);
  if (semanticGap > GROUP_MERGE_MAX_SEMANTIC_GAP) return null;

  return {
    targetKey: top.groupKey,
    sourceKey: second.groupKey,
    targetSemantic: top.semantic,
    sourceSemantic: second.semantic,
    semanticGap,
  };
}

async function mergeGroups(
  candidate: MergeCandidate,
  settings: Settings,
): Promise<void> {
  const groups = await getAllGroups();
  const target = groups[candidate.targetKey];
  const source = groups[candidate.sourceKey];
  if (!target || !source) return;
  if (target.groupKey === source.groupKey) return;

  const moved = await moveChromeGroupTabs(
    source.chromeGroupId,
    target.chromeGroupId,
  );
  if (!moved) return;

  const merged = buildMergedGroup(target, source, settings);
  const groupsForLabel = { ...groups, [merged.groupKey]: merged };
  delete groupsForLabel[source.groupKey];
  const nextLabel = computeLabel(merged, groupsForLabel);
  if (nextLabel) {
    merged.label = nextLabel;
    merged.color = pickColor(nextLabel);
  }

  await saveGroup(merged);
  await remapTabStates(source.groupKey, target.groupKey);
  await deleteGroup(source.groupKey);

  try {
    await chrome.tabGroups.update(target.chromeGroupId, {
      title: merged.label,
      color: merged.color,
    });
  } catch (err) {
    console.warn("[auto-tab-group] update merged group failed", err);
  }

  console.info(
    `[auto-tab-group] merged similar groups "${source.label}" -> "${target.label}" ` +
      `(sem=${candidate.sourceSemantic.toFixed(3)}->${candidate.targetSemantic.toFixed(3)}, gap=${candidate.semanticGap.toFixed(3)})`,
  );
}

async function moveChromeGroupTabs(
  sourceChromeGroupId: number,
  targetChromeGroupId: number,
): Promise<boolean> {
  let sourceTabs: chrome.tabs.Tab[] = [];
  try {
    sourceTabs = await chrome.tabs.query({ groupId: sourceChromeGroupId });
  } catch (err) {
    console.warn("[auto-tab-group] query source group tabs failed", err);
    return false;
  }

  const tabIds = sourceTabs
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === "number");
  if (tabIds.length === 0) return true;

  try {
    await chrome.tabs.group({ tabIds, groupId: targetChromeGroupId });
    return true;
  } catch (err) {
    console.warn("[auto-tab-group] move merged tabs failed", err);
    return false;
  }
}

function buildMergedGroup(
  target: GroupRecord,
  source: GroupRecord,
  settings: Settings,
): GroupRecord {
  const documents = dedupeAndLimitDocuments(
    [...target.documents, ...source.documents],
    settings.maxDocsPerGroup,
  );
  const centroid = recomputeCentroid(documents) ?? target.centroid;

  return {
    ...target,
    centroid,
    documents,
    docCount: documents.length,
    createdAt: Math.min(target.createdAt, source.createdAt),
    updatedAt: Math.max(target.updatedAt, source.updatedAt),
    lastActiveAt: Math.max(target.lastActiveAt, source.lastActiveAt),
    domains: mergeDomains(target.domains, source.domains),
  };
}

function dedupeAndLimitDocuments(
  documents: GroupDocument[],
  maxDocsPerGroup: number,
): GroupDocument[] {
  const byTabId = new Map<number, GroupDocument>();
  for (const doc of documents) {
    const existing = byTabId.get(doc.tabId);
    if (!existing || doc.updatedAt >= existing.updatedAt) {
      byTabId.set(doc.tabId, doc);
    }
  }

  return [...byTabId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, maxDocsPerGroup);
}

function mergeDomains(
  targetDomains: Record<string, number>,
  sourceDomains: Record<string, number>,
): Record<string, number> {
  const merged = { ...targetDomains };
  for (const [domain, count] of Object.entries(sourceDomains)) {
    merged[domain] = (merged[domain] ?? 0) + count;
  }
  return merged;
}

async function remapTabStates(
  sourceGroupKey: string,
  targetGroupKey: string,
): Promise<void> {
  const tabStates = await getAllTabStates();
  for (const state of Object.values(tabStates)) {
    if (state.groupKey !== sourceGroupKey) continue;
    await saveTabState({ ...state, groupKey: targetGroupKey });
  }
}

async function createNewGroup(
  tabId: number,
  embedding: number[],
  tokens: string[],
  content: ExtractedContent,
): Promise<GroupRecord> {
  const groupKey = makeGroupKey();
  const chromeGroupId = await chrome.tabs.group({ tabIds: [tabId] });
  const domain = extractDomainFromUrl(content.url);

  const tempGroup: GroupRecord = {
    groupKey,
    chromeGroupId,
    centroid: embedding.slice(),
    docCount: 1,
    documents: [
      {
        tabId,
        title: content.title ?? "",
        url: content.url ?? "",
        domain,
        snippet: (content.contentSnippet ?? "").slice(0, 300),
        tokens,
        embedding: embedding.slice(),
        collectedAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    label: tokens[0] ?? "새 그룹",
    color: "blue",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastActiveAt: Date.now(),
    domains: domain ? { [domain]: 1 } : {},
  };

  const allGroups = await getAllGroups();
  const label = computeLabel(tempGroup, {
    ...allGroups,
    [groupKey]: tempGroup,
  });
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

/** Removes a tab from ONE specific group and recomputes that group's centroid. */
async function removeTabFromGroup(
  tabId: number,
  groupKey: string,
): Promise<void> {
  const groups = await getAllGroups();
  const group = groups[groupKey];
  if (!group) return;

  const idx = group.documents.findIndex((d) => d.tabId === tabId);
  if (idx === -1) return;

  group.documents.splice(idx, 1);
  group.docCount = Math.max(0, group.docCount - 1);
  group.updatedAt = Date.now();

  if (group.documents.length === 0) {
    await deleteGroup(groupKey);
    try {
      await chrome.tabGroups.update(group.chromeGroupId, { collapsed: false });
    } catch {
      /* already gone */
    }
    return;
  }

  const newCentroid = recomputeCentroid(group.documents);
  if (newCentroid !== null) group.centroid = newCentroid;

  await saveGroup(group);
  await updateLabelIfNeeded(group);
}

async function persistTabState(
  tabId: number,
  groupKey: string | null,
  passageText: string,
  content: ExtractedContent,
  extra?: { urlDirty?: boolean },
): Promise<void> {
  const settings = await getSettings();
  const isShortContent =
    (content.contentSnippet?.length ?? 0) < settings.reclassifyMinChars;
  const existing = await getTabState(tabId);
  const state: TabState = {
    tabId,
    groupKey,
    lastUrl: content.url ?? "",
    lastEmbeddingHash: hashString(passageText),
    pendingReclassify: isShortContent,
    lastClassifiedAt: Date.now(),
    firstSeenAt: existing?.firstSeenAt ?? Date.now(),
    navigationVersion: existing?.navigationVersion ?? 0,
    urlDirty: extra?.urlDirty ?? false,
  };
  await saveTabState(state);
}

async function markPendingReclassify(
  tabId: number,
  passageText: string,
  content: ExtractedContent,
): Promise<void> {
  const existing = await getTabState(tabId);
  const state: TabState = {
    tabId,
    groupKey: existing?.groupKey ?? null,
    lastUrl: existing?.lastUrl ?? content.url ?? "",
    lastEmbeddingHash: hashString(passageText),
    pendingReclassify: true,
    lastClassifiedAt: Date.now(),
    firstSeenAt: existing?.firstSeenAt ?? Date.now(),
    navigationVersion: existing?.navigationVersion ?? 0,
    urlDirty: existing?.urlDirty ?? false,
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
        await chrome.tabGroups.update(group.chromeGroupId, {
          collapsed: false,
        });
      } catch {
        /* already gone */
      }
      continue;
    }

    const newCentroid = recomputeCentroid(group.documents);
    if (newCentroid !== null) group.centroid = newCentroid;

    await saveGroup(group);
    await updateLabelIfNeeded(group);
  }
  if (touched) await rebalanceLabelsAcrossGroups();
}

async function rebalanceLabelsAcrossGroups(): Promise<void> {
  const groups = await getAllGroups();
  for (const groupKey of Object.keys(groups)) {
    await updateLabelIfNeeded(groups[groupKey]);
  }
}
