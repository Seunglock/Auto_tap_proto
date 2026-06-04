import { cosineSimilarity, l2Normalize } from "./embedder";
import { TAB_GROUP_COLORS } from "@/shared/constants";
import type { GroupDocument, GroupRecord, TabGroupColor } from "@/shared/types";

export type Match = {
  groupKey: string;
  similarity: number;
};

export function findBestMatch(
  embedding: number[],
  groups: Record<string, GroupRecord>,
): Match | null {
  let best: Match | null = null;
  for (const groupKey of Object.keys(groups)) {
    const group = groups[groupKey];
    const sim = cosineSimilarity(embedding, group.centroid);
    if (best === null || sim > best.similarity) {
      best = { groupKey, similarity: sim };
    }
  }
  return best;
}

const CENTROID_EMA_ALPHA = 0.25;

export function updateCentroid(
  centroid: number[],
  docCount: number,
  newEmbedding: number[],
): number[] {
  if (docCount === 0) return l2Normalize(newEmbedding);
  const alpha = CENTROID_EMA_ALPHA;
  const next = new Array<number>(centroid.length);
  for (let i = 0; i < centroid.length; i++) {
    next[i] = (1 - alpha) * centroid[i] + alpha * newEmbedding[i];
  }
  return l2Normalize(next);
}

export function pickColor(label: string): TabGroupColor {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  return TAB_GROUP_COLORS[h % TAB_GROUP_COLORS.length];
}

export function makeGroupKey(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Recomputes the centroid from scratch using stored per-document embeddings.
 * Returns null when no document has a valid embedding (e.g. migrated old data).
 */
export function recomputeCentroid(documents: GroupDocument[]): number[] | null {
  const valid = documents
    .map((d) => d.embedding)
    .filter((e) => Array.isArray(e) && e.length > 0);
  if (valid.length === 0) return null;
  const dim = valid[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const emb of valid) {
    for (let i = 0; i < dim; i++) sum[i] += emb[i];
  }
  return l2Normalize(sum.map((v) => v / valid.length));
}
