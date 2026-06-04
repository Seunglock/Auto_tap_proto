/**
 * Composite group-matching scorer.
 *
 * Weights:
 *   semantic  80% — cosine similarity of embeddings
 *   temporal  10% — recency of group activity
 *   domain    10% — domain overlap with group
 *
 * A low extractionConfidence penalises the total score slightly so that
 * noisy extractions are less likely to trigger group moves.
 */
import { cosineSimilarity } from "./embedder";
import type { ExtractedContent, GroupRecord } from "@/shared/types";

export type GroupScore = {
  groupKey: string;
  semantic: number;
  temporal: number;
  domain: number;
  total: number;
};

const W_SEMANTIC = 0.80;
const W_TEMPORAL = 0.10;
const W_DOMAIN   = 0.10;

/** Rolling 30-minute window for temporal affinity. */
const TEMPORAL_WINDOW_MS = 30 * 60 * 1000;

export function scoreGroups(
  embedding: number[],
  content: ExtractedContent,
  groups: Record<string, GroupRecord>,
  nowMs: number = Date.now(),
): GroupScore[] {
  const domain = extractDomain(content.url);
  const confidenceFactor =
    content.extractionConfidence !== undefined
      ? 0.90 + content.extractionConfidence * 0.10
      : 1.0;

  const scores: GroupScore[] = [];
  for (const groupKey of Object.keys(groups)) {
    const group = groups[groupKey];
    const semantic = cosineSimilarity(embedding, group.centroid);
    const temporal = temporalAffinity(group, nowMs);
    const domainScore = domainAffinity(domain, group);
    const total =
      (semantic * W_SEMANTIC + temporal * W_TEMPORAL + domainScore * W_DOMAIN) *
      confidenceFactor;
    scores.push({ groupKey, semantic, temporal, domain: domainScore, total });
  }
  scores.sort((a, b) => b.total - a.total);
  return scores;
}

function temporalAffinity(group: GroupRecord, nowMs: number): number {
  const lastActive = group.lastActiveAt ?? group.updatedAt;
  const elapsed = nowMs - lastActive;
  if (elapsed <= 0) return 1.0;
  if (elapsed >= TEMPORAL_WINDOW_MS) return 0.0;
  return 1.0 - elapsed / TEMPORAL_WINDOW_MS;
}

function domainAffinity(domain: string, group: GroupRecord): number {
  if (!domain || !group.domains) return 0.0;
  const count = group.domains[domain] ?? 0;
  if (count === 0) return 0.0;
  const total = Object.values(group.domains).reduce((a, b) => a + b, 0);
  return total > 0 ? Math.min(count / total, 1.0) : 0.0;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
