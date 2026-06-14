import type { ContentFact, ContentSection, RichContent } from "./types";

export function mergeRichContent(
  existing?: RichContent,
  incoming?: RichContent,
): RichContent | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    summary: preferLonger(existing.summary, incoming.summary),
    bodyText: preferLonger(existing.bodyText, incoming.bodyText),
    sections: mergeSections(existing.sections, incoming.sections),
    facts: mergeFacts(existing.facts, incoming.facts),
    conversationTurns:
      (incoming.conversationTurns?.length ?? 0) >=
      (existing.conversationTurns?.length ?? 0)
        ? incoming.conversationTurns
        : existing.conversationTurns,
    conversationInsights: mergeConversationInsights(
      existing.conversationInsights,
      incoming.conversationInsights,
    ),
    codeBlocks:
      (incoming.codeBlocks?.length ?? 0) >= (existing.codeBlocks?.length ?? 0)
        ? incoming.codeBlocks
        : existing.codeBlocks,
    video:
      incoming.video || existing.video
        ? {
            videoTitle:
              incoming.video?.videoTitle ||
              existing.video?.videoTitle ||
              "",
            channel: incoming.video?.channel || existing.video?.channel,
            description: preferLonger(
              existing.video?.description,
              incoming.video?.description,
            ),
          }
        : undefined,
  };
}

export function richContentScore(content?: RichContent): number {
  if (!content) return 0;
  return (
    (content.summary?.length ?? 0) +
    (content.bodyText?.length ?? 0) +
    (content.sections?.reduce((sum, section) => sum + section.text.length, 0) ??
      0) +
    (content.facts?.reduce((sum, fact) => sum + fact.detail.length, 0) ?? 0) *
      2 +
    (content.conversationInsights?.reduce(
      (sum, insight) => sum + insight.answerSummary.length,
      0,
    ) ??
      0) *
      2 +
    (content.video?.description?.length ?? 0)
  );
}

function mergeConversationInsights(
  existing: RichContent["conversationInsights"],
  incoming: RichContent["conversationInsights"],
): RichContent["conversationInsights"] {
  const values = [...(incoming ?? []), ...(existing ?? [])];
  const seen = new Set<string>();
  const merged = values.filter((insight) => {
    const key = insight.question.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
    if (!insight.answerSummary || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.length > 0 ? merged.slice(0, 8) : undefined;
}

function mergeSections(
  existing: ContentSection[] | undefined,
  incoming: ContentSection[] | undefined,
): ContentSection[] | undefined {
  const values = [...(incoming ?? []), ...(existing ?? [])];
  const seen = new Set<string>();
  const merged = values.filter((section) => {
    const key = `${section.heading ?? ""}|${section.text.slice(0, 160)}`
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!section.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.length > 0 ? merged.slice(0, 8) : undefined;
}

function mergeFacts(
  existing: ContentFact[] | undefined,
  incoming: ContentFact[] | undefined,
): ContentFact[] | undefined {
  const values = [...(incoming ?? []), ...(existing ?? [])];
  const seen = new Set<string>();
  const merged = values.filter((fact) => {
    const key = `${fact.subject}|${fact.detail.slice(0, 180)}`
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!fact.detail || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.length > 0 ? merged.slice(0, 30) : undefined;
}

function preferLonger(
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.length >= existing.length ? incoming : existing;
}
