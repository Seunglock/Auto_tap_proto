import type {
  CollectionSummary,
  GroupRecord,
  GroupSummary,
} from "@/shared/types";

export function buildCollectionSummary(
  groups: Record<string, GroupRecord>,
): CollectionSummary {
  const groupList = Object.values(groups);

  const totalDocuments = groupList.reduce((s, g) => s + g.docCount, 0);

  const lastUpdatedAt = groupList.reduce<number | null>((max, g) => {
    return max === null || g.updatedAt > max ? g.updatedAt : max;
  }, null);

  // Global top keywords (simple frequency across all groups)
  const globalFreq = new Map<string, number>();
  for (const g of groupList) {
    for (const doc of g.documents) {
      for (const t of doc.tokens) {
        globalFreq.set(t, (globalFreq.get(t) ?? 0) + 1);
      }
    }
  }
  const topKeywords = [...globalFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  const groups_summaries = groupList.map(buildGroupSummary);

  return {
    totalGroups: groupList.length,
    totalDocuments,
    lastUpdatedAt,
    topKeywords,
    groups: groups_summaries,
  };
}

function buildGroupSummary(group: GroupRecord): GroupSummary {
  // Per-group token frequency
  const tokenFreq = new Map<string, number>();
  for (const doc of group.documents) {
    for (const t of doc.tokens) {
      tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
    }
  }
  const topKeywords = [...tokenFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  // Top domains from group.domains map
  const topDomains = Object.entries(group.domains ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d]) => d);

  // Most recent unique titles
  const seen = new Set<string>();
  const recentTitles: string[] = [];
  for (const doc of [...group.documents].reverse()) {
    if (!doc.title) continue;
    const key = doc.title.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    recentTitles.push(doc.title);
    if (recentTitles.length >= 3) break;
  }

  return {
    groupKey: group.groupKey,
    label: group.label,
    color: group.color,
    docCount: group.docCount,
    topKeywords,
    topDomains,
    recentTitles,
    updatedAt: group.updatedAt,
  };
}
