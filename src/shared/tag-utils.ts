import { STOPWORDS } from "./constants";

export type TagCluster = {
  label: string;
  aliases: string[];
};

const NOISE_TAGS = new Set([
  "article",
  "blog",
  "browser",
  "click",
  "content",
  "detail",
  "google",
  "homepage",
  "instagram",
  "more",
  "naver",
  "official",
  "page",
  "post",
  "result",
  "search",
  "site",
  "video",
  "view",
  "web",
  "youtube",
  "검색",
  "검색결과",
  "공식",
  "글",
  "내용",
  "더보기",
  "동영상",
  "메뉴",
  "블로그",
  "사이트",
  "페이지",
  "홈",
]);

const URL_OR_DOMAIN = /(?:https?:|www\.|[a-z0-9-]+\.(?:com|net|org|io|kr|jp))/i;
const NUMBER_ONLY = /^[\d\s.,:/_-]+$/;

export function normalizeTag(tag: string): string {
  return tag
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

export function isUsefulTag(tag: string): boolean {
  const trimmed = tag.normalize("NFKC").replace(/^#+/, "").trim();
  const normalized = normalizeTag(trimmed);
  if (trimmed.length < 2 || trimmed.length > 32) return false;
  if (normalized.length < 2 || NUMBER_ONLY.test(trimmed)) return false;
  if (URL_OR_DOMAIN.test(trimmed)) return false;
  if (STOPWORDS.has(trimmed.toLowerCase()) || STOPWORDS.has(normalized))
    return false;
  if (NOISE_TAGS.has(trimmed.toLowerCase()) || NOISE_TAGS.has(normalized))
    return false;
  return true;
}

export function clusterTags(tags: string[], limit = 14): TagCluster[] {
  const clusters: TagCluster[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const tag = rawTag.normalize("NFKC").replace(/^#+/, "").trim();
    const normalized = normalizeTag(tag);
    if (!isUsefulTag(tag) || seen.has(normalized)) continue;
    seen.add(normalized);

    const existing = clusters.find((cluster) =>
      areSimilarTags(tag, cluster.label),
    );
    if (existing) {
      existing.aliases.push(tag);
      existing.label = chooseLabel(existing.aliases);
      continue;
    }
    clusters.push({ label: tag, aliases: [tag] });
  }

  return clusters.slice(0, limit);
}

export function filterUsefulTags(tags: string[], limit = tags.length): string[] {
  return clusterTags(tags, limit).map((cluster) => cluster.label);
}

function areSimilarTags(left: string, right: string): boolean {
  const a = normalizeTag(left);
  const b = normalizeTag(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))
    return true;

  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  if (leftWords.size < 2 || rightWords.size < 2) return false;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return overlap / union >= 0.6;
}

function wordSet(tag: string): Set<string> {
  return new Set(
    tag
      .normalize("NFKC")
      .toLowerCase()
      .split(/[\s\p{P}\p{S}]+/u)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2 && !STOPWORDS.has(word)),
  );
}

function chooseLabel(aliases: string[]): string {
  return [...aliases].sort((left, right) => {
    const leftWords = wordSet(left).size;
    const rightWords = wordSet(right).size;
    if (leftWords !== rightWords) return rightWords - leftWords;
    return left.length - right.length;
  })[0];
}
