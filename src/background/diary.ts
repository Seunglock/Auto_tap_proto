import { hashString } from "./embedder";
import { tokenize } from "./labeling";
import { getAllGroups, getTabState } from "./storage";
import { isInternalUrl, isLocalHost } from "./tab-filters";
import type {
  DiaryAnalysis,
  DiaryCategoryKey,
  DiaryDay,
  DiaryEntry,
  DiaryEpisode,
  DiaryGroupSummary,
  DiarySettings,
  DiaryStats,
  DiaryWeek,
  DiaryWeekDay,
  ExtractedContent,
  GroupRecord,
} from "@/shared/types";

const DIARY_KEYS = {
  episodes: "diaryEpisodes",
  entries: "diaryEntries",
  settings: "diarySettings",
} as const;

const DEFAULT_DIARY_SETTINGS: DiarySettings = {
  collectionEnabled: true,
  sensitiveFilterEnabled: true,
  backfillDays: 7,
  geminiApiKey: "",
};

const CATEGORY_META: Record<
  DiaryCategoryKey,
  { label: string; keywords: string[]; domains: string[] }
> = {
  dev: {
    label: "AI · 개발",
    keywords: [
      "ai",
      "api",
      "code",
      "coding",
      "developer",
      "github",
      "javascript",
      "llm",
      "prompt",
      "python",
      "react",
      "typescript",
      "개발",
      "깃허브",
      "코드",
      "프롬프트",
    ],
    domains: [
      "github.com",
      "stackoverflow.com",
      "docs.",
      "developer.",
      "anthropic.com",
      "openai.com",
      "ai.google.dev",
      "aistudio.google.com",
      "claude.ai",
      "chatgpt.com",
      "gemini.google.com",
    ],
  },
  ent: {
    label: "영상 · 엔터",
    keywords: ["video", "youtube", "netflix", "reels", "music", "영상", "음악"],
    domains: ["youtube.com", "netflix.com", "vimeo.com", "twitch.tv"],
  },
  news: {
    label: "뉴스 · 정보",
    keywords: ["news", "article", "newsletter", "reddit", "뉴스", "아티클"],
    domains: [
      "news.",
      "techcrunch.com",
      "verge.com",
      "tldr.tech",
      "reddit.com",
    ],
  },
  life: {
    label: "요리 · 라이프",
    keywords: [
      "cook",
      "food",
      "recipe",
      "shopping",
      "요리",
      "레시피",
      "장보기",
    ],
    domains: ["kurly.com", "10000recipe.com", "instagram.com"],
  },
  sens: {
    label: "민감",
    keywords: [
      "bank",
      "card",
      "finance",
      "health",
      "hospital",
      "insurance",
      "medical",
      "password",
      "account",
      "clinic",
      "금융",
      "병원",
      "보험",
      "비밀번호",
      "의료",
      "은행",
      "증상",
      "카드",
    ],
    domains: [
      "bank",
      "card",
      "hospital",
      "clinic",
      "nhis.or.kr",
      "hira.or.kr",
      "insurance",
    ],
  },
};

type RecordDiaryEpisodeInput = {
  tabId: number;
  group: GroupRecord;
  content: ExtractedContent;
  tokens: string[];
};

type GroupMatch = {
  groupKey: string | null;
  groupLabel: string;
  keywords: string[];
  score: number;
};

export async function getDiarySettings(): Promise<DiarySettings> {
  const result = await chrome.storage.local.get(DIARY_KEYS.settings);
  return {
    ...DEFAULT_DIARY_SETTINGS,
    ...(result[DIARY_KEYS.settings] as Partial<DiarySettings> | undefined),
  };
}

export async function updateDiarySettings(
  patch: Partial<DiarySettings>,
): Promise<DiarySettings> {
  const current = await getDiarySettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [DIARY_KEYS.settings]: next });
  return next;
}

export async function recordDiaryEpisodeFromClassification(
  input: RecordDiaryEpisodeInput,
): Promise<void> {
  const settings = await getDiarySettings();
  if (!settings.collectionEnabled) return;

  const now = Date.now();
  const episodes = await getAllDiaryEpisodes();
  const url = input.content.url ?? "";
  const domain = extractDomain(input.content.url);
  const groupKeywords = topKeywordsForGroup(input.group, input.tokens);
  const text = [
    input.content.title,
    input.content.url,
    input.content.contentSnippet,
    input.content.richContent?.bodyText?.slice(0, 4_000),
    input.group.label,
    groupKeywords.join(" "),
  ].join(" ");
  const isSensitive = settings.sensitiveFilterEnabled && detectSensitive(text);
  const categoryKey = isSensitive
    ? "sens"
    : detectCategory(text, domain, input.group.label);
  const id = await resolveClassifiedEpisodeId(episodes, input.tabId, url, now);

  const episode: DiaryEpisode = {
    id,
    dateKey: dateKey(now),
    startedAt: now,
    durationMs: 60 * 1000,
    durationSource: "estimated",
    title: input.content.title ?? "",
    url,
    domain,
    snippet: (input.content.contentSnippet ?? "").slice(0, 300),
    richContent: input.content.richContent,
    pageType: input.content.pageType,
    headings: input.content.headings?.slice(0, 5),
    groupKey: input.group.groupKey,
    groupLabel: input.group.label || "기타",
    keywords: groupKeywords,
    tokens: unique(input.tokens).slice(0, 20),
    categoryKey,
    isSensitive,
    source: "classified-tab",
    createdAt: now,
    updatedAt: now,
  };

  await upsertDiaryEpisode(episode);
}

export async function backfillHistory(days?: number): Promise<number> {
  const settings = await getDiarySettings();
  const windowDays = Math.max(1, Math.min(days ?? settings.backfillDays, 30));
  const startTime = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const endTime = Date.now();
  const historyItems = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 5000,
  });
  const groups = await getAllGroups();
  const episodes = await getAllDiaryEpisodes();
  let imported = 0;

  for (const item of historyItems) {
    if (!item.url || isInternalUrl(item.url) || isLocalHost(item.url)) continue;
    const title = item.title ?? "";
    const domain = extractDomain(item.url);
    const tokens = tokenize(`${title} ${domain} ${item.url}`);
    const match = matchHistoryToGroup(title, item.url, tokens, groups);
    const text = `${title} ${item.url} ${match.groupLabel} ${match.keywords.join(" ")}`;
    const isSensitive =
      settings.sensitiveFilterEnabled && detectSensitive(text);
    const categoryKey = isSensitive
      ? "sens"
      : detectCategory(text, domain, match.groupLabel);
    const visits = await chrome.history.getVisits({ url: item.url });

    for (const visit of visits) {
      const startedAt = visit.visitTime ?? item.lastVisitTime ?? Date.now();
      if (startedAt < startTime || startedAt > endTime) continue;

      const id = `history:${hashString(item.url)}:${Math.floor(startedAt)}`;
      if (episodes[id]) continue;

      episodes[id] = {
        id,
        dateKey: dateKey(startedAt),
        startedAt,
        durationMs: 60 * 1000,
        durationSource: "estimated",
        title,
        url: item.url,
        domain,
        snippet: "",
        richContent: undefined,
        pageType: undefined,
        headings: undefined,
        groupKey: match.groupKey,
        groupLabel: match.groupLabel,
        keywords: match.keywords,
        tokens: unique(tokens).slice(0, 20),
        categoryKey,
        isSensitive,
        source: match.groupKey ? "history-backfill" : "history-fallback",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      imported += 1;
    }
  }

  await chrome.storage.local.set({ [DIARY_KEYS.episodes]: episodes });
  return imported;
}

export async function getDiaryDay(date?: string): Promise<DiaryDay> {
  const target = date ?? dateKey(Date.now());
  const [episodes, entries] = await Promise.all([
    getAllDiaryEpisodes(),
    getAllDiaryEntries(),
  ]);
  const dayEpisodes = Object.values(episodes)
    .filter((episode) => episode.dateKey === target)
    .sort((a, b) => a.startedAt - b.startedAt);

  return buildDiaryDay(target, dayEpisodes, entries[target] ?? null);
}

export async function getDiaryWeek(date?: string): Promise<DiaryWeek> {
  const targetDate = parseDateKey(date ?? dateKey(Date.now()));
  const start = startOfWeek(targetDate);
  const end = addDays(start, 6);
  const episodes = Object.values(await getAllDiaryEpisodes());
  const days: DiaryWeekDay[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const current = addDays(start, offset);
    const currentKey = dateKey(current.getTime());
    const dayEpisodes = episodes.filter(
      (episode) => episode.dateKey === currentKey,
    );
    const day = buildDiaryDay(currentKey, dayEpisodes, null);
    days.push({
      dateKey: currentKey,
      label: formatDayLabel(current),
      stats: day.stats,
      topGroups: day.topGroups,
      topKeywords: day.topKeywords,
    });
  }

  return {
    startDateKey: dateKey(start.getTime()),
    endDateKey: dateKey(end.getTime()),
    days,
  };
}

export async function getDiaryAnalysis(date?: string): Promise<DiaryAnalysis> {
  const target = date ?? dateKey(Date.now());
  const week = await getDiaryWeek(target);
  const episodes = Object.values(await getAllDiaryEpisodes()).filter(
    (episode) =>
      episode.dateKey >= week.startDateKey &&
      episode.dateKey <= week.endDateKey,
  );
  const safeEpisodes = episodes.filter((episode) => !episode.isSensitive);
  const topKeywords = frequency(
    safeEpisodes.flatMap((episode) => episode.keywords),
  )
    .slice(0, 20)
    .map(([keyword, count]) => ({ keyword, count }));
  const topGroups = groupSummaries(safeEpisodes).slice(0, 6);

  return {
    dateKey: target,
    week,
    topKeywords,
    topGroups,
    recommendations: buildRecommendations(topGroups, topKeywords),
  };
}

export async function generateDiaryEntry(date?: string): Promise<DiaryEntry> {
  const target = date ?? dateKey(Date.now());
  const settings = await getDiarySettings();
  const day = await getDiaryDay(target);
  const safeEpisodes = day.episodes.filter((episode) => !episode.isSensitive);
  const generated =
    settings.geminiApiKey.trim().length > 0
      ? await generateWithGemini(day, settings.geminiApiKey)
      : null;
  const fallback = generated ?? buildRuleBasedEntry(day);
  const now = Date.now();
  const entry: DiaryEntry = {
    dateKey: target,
    summary: fallback.summary,
    body: fallback.body,
    tags: fallback.tags,
    sourceEpisodeIds: safeEpisodes.map((episode) => episode.id),
    createdAt: day.entry?.createdAt ?? now,
    tagNotes: day.entry?.tagNotes,
    updatedAt: now,
  };
  const entries = await getAllDiaryEntries();
  entries[target] = entry;
  await chrome.storage.local.set({ [DIARY_KEYS.entries]: entries });
  return entry;
}

async function upsertDiaryEpisode(episode: DiaryEpisode): Promise<void> {
  const episodes = await getAllDiaryEpisodes();
  const existing = episodes[episode.id];
  const startedAt = existing
    ? Math.min(existing.startedAt, episode.startedAt)
    : episode.startedAt;
  episodes[episode.id] = existing
    ? {
        ...episode,
        createdAt: existing.createdAt,
        dateKey: dateKey(startedAt),
        startedAt,
      }
    : episode;
  await chrome.storage.local.set({ [DIARY_KEYS.episodes]: episodes });
}

async function resolveClassifiedEpisodeId(
  episodes: Record<string, DiaryEpisode>,
  tabId: number,
  url: string,
  now: number,
): Promise<string> {
  const urlHash = hashString(url);
  const tabState = await getTabState(tabId);
  if (tabState?.lastUrl === url) {
    const existingId = findLatestClassifiedEpisodeId(episodes, tabId, url);
    if (existingId) return existingId;
  }
  return `tab:${tabId}:${urlHash}:${Math.floor(now)}`;
}

function findLatestClassifiedEpisodeId(
  episodes: Record<string, DiaryEpisode>,
  tabId: number,
  url: string,
): string | null {
  const prefix = `tab:${tabId}:`;
  const matches = Object.values(episodes)
    .filter(
      (episode) =>
        episode.source === "classified-tab" &&
        episode.id.startsWith(prefix) &&
        episode.url === url,
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  return matches[0]?.id ?? null;
}

async function getAllDiaryEpisodes(): Promise<Record<string, DiaryEpisode>> {
  const result = await chrome.storage.local.get(DIARY_KEYS.episodes);
  return (result[DIARY_KEYS.episodes] as Record<string, DiaryEpisode>) ?? {};
}

async function getAllDiaryEntries(): Promise<Record<string, DiaryEntry>> {
  const result = await chrome.storage.local.get(DIARY_KEYS.entries);
  return (result[DIARY_KEYS.entries] as Record<string, DiaryEntry>) ?? {};
}

function buildDiaryDay(
  target: string,
  episodes: DiaryEpisode[],
  entry: DiaryEntry | null,
): DiaryDay {
  const sorted = [...episodes].sort((a, b) => a.startedAt - b.startedAt);
  const safeEpisodes = sorted.filter((episode) => !episode.isSensitive);
  return {
    dateKey: target,
    episodes: sorted,
    topKeywords: frequency(safeEpisodes.flatMap((episode) => episode.keywords))
      .slice(0, 10)
      .map(([keyword]) => keyword),
    topGroups: groupSummaries(safeEpisodes).slice(0, 6),
    topDomains: frequency(
      safeEpisodes.map((episode) => episode.domain).filter(Boolean),
    )
      .slice(0, 6)
      .map(([domain, count]) => ({ domain, count })),
    stats: statsForEpisodes(sorted),
    entry,
  };
}

function statsForEpisodes(episodes: DiaryEpisode[]): DiaryStats {
  const totalMs = episodes.reduce(
    (sum, episode) => sum + episode.durationMs,
    0,
  );
  return {
    totalEpisodes: episodes.length,
    safeEpisodes: episodes.filter((episode) => !episode.isSensitive).length,
    sensitiveEpisodes: episodes.filter((episode) => episode.isSensitive).length,
    activeMinutes: Math.max(episodes.length, Math.round(totalMs / 60000)),
  };
}

function groupSummaries(episodes: DiaryEpisode[]): DiaryGroupSummary[] {
  const byGroup = new Map<string, DiaryEpisode[]>();
  for (const episode of episodes) {
    const key = episode.groupKey ?? `fallback:${episode.groupLabel}`;
    const list = byGroup.get(key) ?? [];
    list.push(episode);
    byGroup.set(key, list);
  }

  return [...byGroup.entries()]
    .map(([, groupEpisodes]) => {
      const first = groupEpisodes[0];
      const keywords = frequency(groupEpisodes.flatMap((e) => e.keywords))
        .slice(0, 5)
        .map(([keyword]) => keyword);
      return {
        groupKey: first.groupKey,
        label: first.groupLabel || keywords.slice(0, 2).join(" ") || "기타",
        count: groupEpisodes.length,
        keywords,
        categoryKey: first.categoryKey,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function matchHistoryToGroup(
  title: string,
  url: string,
  tokens: string[],
  groups: Record<string, GroupRecord>,
): GroupMatch {
  const textTokens = new Set(tokenize(`${title} ${url}`).concat(tokens));
  let best: GroupMatch = {
    groupKey: null,
    groupLabel: "기록",
    keywords: unique(tokens).slice(0, 5),
    score: 0,
  };

  for (const group of Object.values(groups)) {
    const keywords = topKeywordsForGroup(group, []);
    const candidates = new Set(
      tokenize(`${group.label} ${keywords.join(" ")}`),
    );
    let score = 0;
    for (const token of textTokens) {
      if (candidates.has(token)) score += 1;
    }
    const domain = extractDomain(url);
    if (domain && group.domains[domain]) score += 2;
    if (score > best.score) {
      best = {
        groupKey: group.groupKey,
        groupLabel: group.label || keywords.slice(0, 2).join(" ") || "기록",
        keywords,
        score,
      };
    }
  }

  return best.score > 0
    ? best
    : { ...best, keywords: unique(tokens).slice(0, 5) };
}

function topKeywordsForGroup(
  group: GroupRecord,
  extraTokens: string[],
): string[] {
  const tokens = [
    ...tokenize(group.label),
    ...group.documents.flatMap((doc) => doc.tokens),
    ...extraTokens,
  ];
  return frequency(tokens)
    .slice(0, 6)
    .map(([keyword]) => keyword);
}

function detectSensitive(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    CATEGORY_META.sens.keywords.some((keyword) => lower.includes(keyword)) ||
    CATEGORY_META.sens.domains.some((domain) => lower.includes(domain))
  );
}

function detectCategory(
  text: string,
  domain: string,
  groupLabel: string,
): DiaryCategoryKey {
  const lower = `${text} ${domain} ${groupLabel}`.toLowerCase();
  const candidates: DiaryCategoryKey[] = ["dev", "ent", "news", "life"];
  let best: { key: DiaryCategoryKey; score: number } = {
    key: "news",
    score: 0,
  };

  for (const key of candidates) {
    const meta = CATEGORY_META[key];
    const score =
      meta.keywords.filter((keyword) => lower.includes(keyword)).length +
      meta.domains.filter((domainPattern) => lower.includes(domainPattern))
        .length *
        2;
    if (score > best.score) best = { key, score };
  }

  return best.score > 0 ? best.key : "news";
}

function buildRuleBasedEntry(
  day: DiaryDay,
): Pick<DiaryEntry, "summary" | "body" | "tags"> {
  const topGroups = day.topGroups.slice(0, 3);
  const topKeywords = day.topKeywords.slice(0, 5);
  const concreteFacts = collectConcreteFacts(day).slice(0, 6);
  const main = topGroups[0]?.label ?? topKeywords[0] ?? "디지털 기록";
  const secondary = topGroups[1]?.label;
  const summary =
    concreteFacts.length > 0
      ? `"${concreteFacts[0].subject}"에 관한 구체적인 정보를 확인한 날.`
      : secondary
        ? `"${main}에서 시작해,\n${secondary}까지 이어진 하루."`
        : `"${main} 쪽으로\n조용히 기울어진 하루."`;
  const domains = day.topDomains
    .slice(0, 3)
    .map((d) => d.domain)
    .join(", ");
  const bodyParts = [
    `${formatKoreanDate(day.dateKey)}에는 ${main} 관련 기록이 가장 많이 남았어요.`,
    concreteFacts.length > 0
      ? [
          "오늘 확인한 구체적 내용:",
          ...concreteFacts.map(
            (fact) => `- ${fact.subject}: ${fact.detail.slice(0, 240)}`,
          ),
        ].join("\n")
      : "",
    secondary
      ? `중간중간 ${secondary} 흐름도 이어져서, 관심사가 한 방향에만 머물지는 않았습니다.`
      : "크게 흩어지기보다 비슷한 주제 안에서 탐색이 이어졌습니다.",
    topKeywords.length > 0
      ? `자주 등장한 단어는 ${topKeywords.join(", ")}였습니다.`
      : "",
    domains
      ? `주로 머문 곳은 ${domains}였고, 민감한 기록 ${day.stats.sensitiveEpisodes}개는 일기 내용에서 제외했습니다.`
      : `민감한 기록 ${day.stats.sensitiveEpisodes}개는 일기 내용에서 제외했습니다.`,
  ].filter(Boolean);
  return {
    summary,
    body: bodyParts.join("\n\n"),
    tags: topKeywords.slice(0, 4),
  };
}

function collectConcreteFacts(
  day: DiaryDay,
): Array<{ subject: string; detail: string }> {
  const seen = new Set<string>();
  const facts: Array<{ subject: string; detail: string }> = [];
  for (const episode of day.episodes) {
    if (episode.isSensitive) continue;
    for (const fact of episode.richContent?.facts ?? []) {
      const key = `${fact.subject.toLowerCase()}|${fact.detail
        .toLowerCase()
        .slice(0, 160)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ subject: fact.subject, detail: fact.detail });
    }
  }
  return facts;
}

async function generateWithGemini(
  day: DiaryDay,
  apiKey: string,
): Promise<Pick<DiaryEntry, "summary" | "body" | "tags"> | null> {
  const safeEpisodes = day.episodes.filter((episode) => !episode.isSensitive);
  if (safeEpisodes.length === 0) return null;

  const payload = {
    date: day.dateKey,
    groups: day.topGroups.map((group) => ({
      label: group.label,
      keywords: group.keywords,
      count: group.count,
    })),
    titles: safeEpisodes.slice(0, 20).map((episode) => episode.title),
    contents: safeEpisodes.slice(0, 12).map((episode) => ({
      title: episode.title,
      pageType: episode.pageType,
      summary: episode.richContent?.summary ?? episode.snippet,
      bodyText: episode.richContent?.bodyText?.slice(0, 4_000),
      sections: episode.richContent?.sections?.slice(0, 4),
      facts: episode.richContent?.facts?.slice(0, 12),
      headings: episode.headings?.slice(0, 3),
      video: episode.richContent?.video,
      conversationTurns: episode.richContent?.conversationTurns?.slice(-3),
    })),
    domains: day.topDomains.map((domain) => domain.domain),
    keywords: day.topKeywords,
  };
  const prompt =
    "다음 브라우저 활동 요약만 사용해서 한국어 일기를 작성해줘. " +
    "민감한 항목은 이미 제외되어 있으니 추측하지 마. JSON으로만 응답하고 키는 summary, body, tags를 써. " +
    JSON.stringify(payload);

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      encodeURIComponent(apiKey);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = parseJsonObject(text);
    if (!parsed) return null;
    return {
      summary: String(parsed.summary ?? ""),
      body: String(parsed.body ?? ""),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map(String).slice(0, 6)
        : day.topKeywords.slice(0, 4),
    };
  } catch (err) {
    console.warn("[auto-tab-group] diary Gemini generation failed", err);
    return null;
  }
}

function buildRecommendations(
  groups: DiaryGroupSummary[],
  keywords: Array<{ keyword: string; count: number }>,
): Array<{ title: string; body: string; tags: string[] }> {
  const main = groups[0];
  const second = groups[1];
  const kw = keywords.slice(0, 3).map((k) => k.keyword);
  return [
    {
      title: main
        ? `${main.label} 흐름을 이어가보세요`
        : "오늘의 기록을 더 모아보세요",
      body: main
        ? `${main.count}개의 기록이 이 주제에 모였어요. 다음에는 관련 문서나 작업 결과를 하나로 정리해볼 만합니다.`
        : "방문 기록이 쌓이면 관심 흐름을 더 선명하게 보여드릴 수 있어요.",
      tags: main?.keywords.slice(0, 3) ?? kw,
    },
    {
      title: second
        ? `${second.label}도 함께 자라고 있어요`
        : "반복 키워드를 살펴보세요",
      body: second
        ? "주요 관심사 옆에 반복해서 등장한 보조 흐름입니다. 다음 일기의 좋은 단서가 될 수 있어요."
        : `이번 주 자주 등장한 단어는 ${kw.join(", ") || "아직 없음"}입니다.`,
      tags: second?.keywords.slice(0, 3) ?? kw,
    },
  ];
}

function frequency(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dateKey(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDayLabel(date: Date): string {
  const dow = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
  return `${String(date.getDate()).padStart(2, "0")} ${dow}`;
}

function formatKoreanDate(key: string): string {
  const d = parseDateKey(key);
  const dow = [
    "일요일",
    "월요일",
    "화요일",
    "수요일",
    "목요일",
    "금요일",
    "토요일",
  ][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${dow}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "");
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function saveDiaryEntry(
  dateKey: string,
  patch: {
    summary?: string;
    body?: string;
    bodyHtml?: string;
    tags?: string[];
    format?: import("@/shared/types").DiaryTextFormat;
    tagNotes?: Record<string, import("@/shared/types").DiaryTagNote>;
  },
): Promise<DiaryEntry> {
  const entries = await getAllDiaryEntries();
  const existing = entries[dateKey];
  if (!existing) {
    throw new Error(`[diary] No entry found for ${dateKey}`);
  }
  const updated: DiaryEntry = {
    ...existing,
    ...(patch.summary !== undefined && { summary: patch.summary }),
    ...(patch.body !== undefined && { body: patch.body }),
    ...(patch.bodyHtml !== undefined && { bodyHtml: patch.bodyHtml }),
    ...(patch.tags !== undefined && { tags: patch.tags }),
    ...(patch.format !== undefined && { format: patch.format }),
    ...(patch.tagNotes !== undefined && { tagNotes: patch.tagNotes }),
    updatedAt: Date.now(),
  };
  entries[dateKey] = updated;
  await chrome.storage.local.set({ [DIARY_KEYS.entries]: entries });
  return updated;
}
