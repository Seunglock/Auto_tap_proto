/**
 * Decides what to do with a tab that is already in a group when its
 * URL or content changes significantly.
 *
 * URL changes use the normal classification threshold. If no existing group
 * clears that bar, the tab should leave its stale group and form a new one.
 */
import type { GroupRecord, Settings } from "@/shared/types";
import type { GroupScore } from "./scoring";

export type ReclassifyDecision =
  | { action: "keep";       groupKey: string;                    score: number }
  | { action: "move";       fromGroupKey: string; toGroupKey: string; score: number }
  | { action: "ungroup";    fromGroupKey: string; reason: string }
  | { action: "create-new"; fromGroupKey: string | null }
  | { action: "defer";      groupKey: string };

export function decideReclassification(
  currentGroupKey: string,
  scores: GroupScore[],
  groups: Record<string, GroupRecord>,
  settings: Settings,
  options: { allowUngroup?: boolean } = {},
): ReclassifyDecision {
  const threshold = settings.threshold;

  const currentScore = scores.find((s) => s.groupKey === currentGroupKey);

  // Group was deleted externally
  if (!currentScore || !groups[currentGroupKey]) {
    return { action: "ungroup", fromGroupKey: currentGroupKey, reason: "group-gone" };
  }

  // Still clears the normal group threshold — keep
  if (currentScore.total >= threshold) {
    return { action: "keep", groupKey: currentGroupKey, score: currentScore.total };
  }

  // Another existing group clears the threshold — move there
  const bestOther = scores.find((s) => s.groupKey !== currentGroupKey);
  if (bestOther && bestOther.total >= threshold) {
    return {
      action: "move",
      fromGroupKey: currentGroupKey,
      toGroupKey: bestOther.groupKey,
      score: bestOther.total,
    };
  }

  // URL-change regrouping disabled — avoid splitting the tab out.
  if (options.allowUngroup === false) {
    return { action: "defer", groupKey: currentGroupKey };
  }

  // No existing group is good enough — create a fresh group for the new URL.
  return { action: "create-new", fromGroupKey: currentGroupKey };
}
