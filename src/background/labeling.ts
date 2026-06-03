import { STOPWORDS } from "@/shared/constants";
import type { GroupRecord } from "@/shared/types";

const TOKEN_SPLIT = /[\s\p{P}\p{S}]+/u;
const NUMBER_LIKE = /^\d+$/;
const URL_LIKE = /^https?:\/\//i;

export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return lower
    .split(TOKEN_SPLIT)
    .map((t) => t.trim())
    .filter((t) => isUsefulToken(t));
}

function isUsefulToken(t: string): boolean {
  if (t.length < 2) return false;
  if (NUMBER_LIKE.test(t)) return false;
  if (URL_LIKE.test(t)) return false;
  if (STOPWORDS.has(t)) return false;
  return true;
}

function tokenFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}

export function computeLabel(
  group: GroupRecord,
  allGroups: Record<string, GroupRecord>,
  topK: number = 2,
): string {
  const groupTokens = group.documents.flatMap((d) => d.tokens);
  if (groupTokens.length === 0) return group.label || "기타";

  const tf = tokenFrequency(groupTokens);
  const totalTokens = groupTokens.length;
  const totalGroups = Object.keys(allGroups).length || 1;

  const dfMap = computeDocumentFrequency(allGroups);

  const scored: Array<{ token: string; score: number }> = [];
  for (const [token, count] of tf) {
    const tfScore = count / totalTokens;
    const df = dfMap.get(token) ?? 0;
    const idf = Math.log((totalGroups + 1) / (df + 1)) + 1;
    scored.push({ token, score: tfScore * idf });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).map((s) => s.token);
  if (top.length === 0) return group.label || "기타";
  return top.join(" ");
}

function computeDocumentFrequency(
  allGroups: Record<string, GroupRecord>,
): Map<string, number> {
  const df = new Map<string, number>();
  for (const groupKey of Object.keys(allGroups)) {
    const group = allGroups[groupKey];
    const seen = new Set<string>();
    for (const doc of group.documents) {
      for (const token of doc.tokens) seen.add(token);
    }
    for (const token of seen) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return df;
}
