/**
 * Decides what to do with a tab that is already in a group when its
 * URL or content changes significantly.
 *
 * Hysteresis thresholds (from settings):
 *   keepThreshold   — below this we start reconsidering the current group
 *   threshold       — above this another group is good enough to move to
 *   ungroupThreshold = keepThreshold * 0.90 — below this we ungroup
 */
import type { GroupRecord, Settings } from "@/shared/types";
import type { GroupScore } from "./scoring";

export type ReclassifyDecision =
  | { action: "keep";       groupKey: string;                    score: number }
  | { action: "move";       fromGroupKey: string; toGroupKey: string; score: number }
  | { action: "ungroup";    fromGroupKey: string; reason: string }
  | { action: "create-new"; fromGroupKey: string | null }
  | { action: "defer" };

export function decideReclassification(
  currentGroupKey: string,
  scores: GroupScore[],
  groups: Record<string, GroupRecord>,
  settings: Settings,
): ReclassifyDecision {
  const keepThreshold    = settings.keepThreshold;
  const moveThreshold    = settings.threshold;
  const ungroupThreshold = keepThreshold * 0.90;

  const currentScore = scores.find((s) => s.groupKey === currentGroupKey);

  // Group was deleted externally
  if (!currentScore || !groups[currentGroupKey]) {
    return { action: "ungroup", fromGroupKey: currentGroupKey, reason: "group-gone" };
  }

  // Still good enough in current group — keep
  if (currentScore.total >= keepThreshold) {
    return { action: "keep", groupKey: currentGroupKey, score: currentScore.total };
  }

  // Below keep threshold — check if another group is better
  const bestOther = scores.find((s) => s.groupKey !== currentGroupKey);
  if (bestOther && bestOther.total >= moveThreshold) {
    return {
      action: "move",
      fromGroupKey: currentGroupKey,
      toGroupKey: bestOther.groupKey,
      score: bestOther.total,
    };
  }

  // Too low for any group — ungroup
  if (currentScore.total < ungroupThreshold) {
    return {
      action: "ungroup",
      fromGroupKey: currentGroupKey,
      reason: "below-ungroup-threshold",
    };
  }

  // Gray zone between ungroupThreshold and keepThreshold — stay put to avoid oscillation
  return { action: "keep", groupKey: currentGroupKey, score: currentScore.total };
}
