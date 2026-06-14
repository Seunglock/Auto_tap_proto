import type { DiaryEpisode } from "./types";

export type ContentQualityGrade = "core" | "context" | "empty";

export type ContentQualityReason =
  | "ai_conversation"
  | "empty_content"
  | "factual_content"
  | "high_link_or_list_signal"
  | "history_only"
  | "rich_body"
  | "search_page"
  | "semantic_article"
  | "short_snippet"
  | "structured_sections"
  | "thin_content"
  | "video_description";

export type ContentQualityResult = {
  grade: ContentQualityGrade;
  score: number;
  reasons: ContentQualityReason[];
};

const CORE_SCORE_THRESHOLD = 70;
const CONTEXT_SCORE_THRESHOLD = 14;

export function classifyDiaryEpisodeContent(
  episode: DiaryEpisode,
): ContentQualityResult {
  const reasons = new Set<ContentQualityReason>();
  const rich = episode.richContent;
  const title = cleanText(episode.title);
  const url = cleanText(episode.url);
  const snippet = cleanText(episode.snippet);
  const summary = cleanText(rich?.summary ?? "");
  const bodyText = cleanText(rich?.bodyText ?? "");
  const videoDescription = cleanText(rich?.video?.description ?? "");
  const usefulSummary = stripLowValueText(summary);
  const usefulBodyText = stripLowValueText(bodyText);
  const usefulSnippet = stripLowValueText(snippet);
  const sectionChars =
    rich?.sections?.reduce((sum, section) => {
      const text = stripLowValueText(section.text);
      return sum + text.length;
    }, 0) ??
    0;
  const factChars =
    rich?.facts?.reduce((sum, fact) => {
      const detail = stripLowValueText(fact.detail);
      return sum + (detail.length < 35 ? 0 : detail.length);
    }, 0) ??
    0;
  const conversationInsightChars =
    rich?.conversationInsights?.reduce(
      (sum, insight) =>
        sum +
        cleanText(insight.question).length +
        cleanText(insight.answerSummary).length,
      0,
    ) ?? 0;
  const conversationTurnChars =
    rich?.conversationTurns?.reduce(
      (sum, turn) => sum + cleanText(turn.text).length,
      0,
    ) ?? 0;
  const conversationChars = conversationInsightChars + conversationTurnChars;

  if (episode.pageType === "search") reasons.add("search_page");
  if (episode.source !== "classified-tab" && !rich) reasons.add("history_only");
  if (usefulSnippet.length > 0 && usefulSnippet.length < 90)
    reasons.add("short_snippet");

  const combined = [usefulSnippet, usefulSummary, usefulBodyText]
    .filter(Boolean)
    .join(" ");
  if (looksListLike(combined)) reasons.add("high_link_or_list_signal");

  let score = 0;

  if (conversationChars >= 80) {
    reasons.add("ai_conversation");
    score += Math.min(140, 70 + conversationChars / 20);
  }

  if (videoDescription.length >= 160) {
    reasons.add("video_description");
    score += Math.min(120, 55 + videoDescription.length / 35);
  }

  if (sectionChars >= 180) {
    reasons.add("structured_sections");
    score += Math.min(115, 45 + sectionChars / 45);
  }

  if (usefulBodyText.length >= 280) {
    reasons.add("rich_body");
    score += Math.min(110, 35 + usefulBodyText.length / 70);
  }

  if (factChars >= 120) {
    reasons.add("factual_content");
    score += Math.min(90, 25 + factChars / 55);
  }

  if (
    (episode.pageType === "article" || episode.pageType === "documentation") &&
    (usefulBodyText.length >= 220 || sectionChars >= 160)
  ) {
    reasons.add("semantic_article");
    score += 24;
  }

  if (reasons.has("high_link_or_list_signal")) score -= 32;
  if (reasons.has("short_snippet")) score -= 12;

  const hasAnyContent =
    title.length > 0 ||
    url.length > 0 ||
    usefulSnippet.length > 0 ||
    usefulSummary.length > 0 ||
    usefulBodyText.length > 0 ||
    sectionChars > 0 ||
    factChars > 0 ||
    videoDescription.length > 0 ||
    conversationChars > 0;

  if (!hasAnyContent) {
    reasons.add("empty_content");
    return { grade: "empty", score: 0, reasons: [...reasons] };
  }

  if (episode.pageType === "search") {
    return {
      grade: "context",
      score: Math.max(CONTEXT_SCORE_THRESHOLD, score),
      reasons: [...reasons],
    };
  }

  if (episode.source !== "classified-tab" && !rich && title.length > 0) {
    reasons.add("thin_content");
    return {
      grade: "context",
      score: CONTEXT_SCORE_THRESHOLD,
      reasons: [...reasons],
    };
  }

  if (score >= CORE_SCORE_THRESHOLD) {
    return { grade: "core", score: Math.round(score), reasons: [...reasons] };
  }

  if (
    score >= CONTEXT_SCORE_THRESHOLD ||
    usefulSnippet.length >= 40 ||
    usefulSummary.length >= 60
  ) {
    reasons.add("thin_content");
    return {
      grade: "context",
      score: Math.max(1, Math.round(score)),
      reasons: [...reasons],
    };
  }

  reasons.add("empty_content");
  return {
    grade: "empty",
    score: Math.max(0, Math.round(score)),
    reasons: [...reasons],
  };
}

function looksListLike(value: string): boolean {
  const text = cleanText(value);
  if (text.length < 80) return false;
  const separators = (text.match(/[|/·•›»]/g) ?? []).length;
  const titleSeparators = (text.match(/\s[-–—]\s/g) ?? []).length;
  const repeatedResultWords =
    (text.match(/(검색결과|추천|관련|더보기|결과|results?|related|more)/gi) ?? [])
      .length;
  const sentenceEndings = (text.match(/[.!?。！？]|다\./g) ?? []).length;
  return (
    separators >= 6 ||
    titleSeparators >= 8 ||
    repeatedResultWords >= 4 ||
    (separators >= 3 && sentenceEndings <= 2)
  );
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripLowValueText(value: string): string {
  return cleanText(value)
    .replace(
      /(최근\s*수정\s*시각|수정\s*시각|최종\s*수정)\s*:?\s*\d{4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?/gi,
      " ",
    )
    .replace(
      /(last\s*modified|updated\s*at)\s*:?\s*[A-Za-z0-9,:\-./\s]{8,40}/gi,
      " ",
    )
    .replace(/^\d{4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?/, " ")
    .replace(/\s+/g, " ")
    .trim();
}
