import { cosineSimilarity, embedText, hashString } from "./embedder";
import { tokenize } from "./labeling";
import { getAllGroups, getTabState } from "./storage";
import { isInternalUrl, isLocalHost } from "./tab-filters";
import { E5_PASSAGE_PREFIX, E5_QUERY_PREFIX } from "@/shared/constants";
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
    domains: ["news.", "techcrunch.com", "verge.com", "tldr.tech", "reddit.com"],
  },
  life: {
    label: "요리 · 라이프",
    keywords: ["cook", "food", "recipe", "shopping", "요리", "레시피", "장보기"],
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
    input.group.label,
    groupKeywords.join(" "),
  ].join(" ");
  const isSensitive = settings.sensitiveFilterEnabled && detectSensitive(text);
  const categoryKey = isSensitive
    ? "sens"
    : detectCategory(text, domain, input.group.label);
  const id = await resolveClassifiedEpisodeId(
    episodes,
    input.tabId,
    url,
    now,
  );

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
    const dayEpisodes = episodes.filter((episode) => episode.dateKey === currentKey);
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
      episode.dateKey >= week.startDateKey && episode.dateKey <= week.endDateKey,
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
  const day = await getDiaryDay(target);
  const safeEpisodes = day.episodes.filter((episode) => !episode.isSensitive);
  // RAG: 오늘 활동을 쿼리로 과거 일기를 e5 임베딩 검색해 생성 맥락으로 주입
  const memories = await retrieveDiaryMemories(day, target);
  console.log(
    "[auto-tab-group] diary RAG 검색 결과",
    memories.length ? memories : "(관련 과거 기록 없음)",
  );
  const generated = await generateWithLocalLLM(day, memories);
  const fallback = generated ?? buildRuleBasedEntry(day);
  const now = Date.now();
  const entry: DiaryEntry = {
    dateKey: target,
    summary: fallback.summary,
    body: fallback.body,
    tags: fallback.tags,
    sourceEpisodeIds: safeEpisodes.map((episode) => episode.id),
    createdAt: day.entry?.createdAt ?? now,
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
  const totalMs = episodes.reduce((sum, episode) => sum + episode.durationMs, 0);
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
    const candidates = new Set(tokenize(`${group.label} ${keywords.join(" ")}`));
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

  return best.score > 0 ? best : { ...best, keywords: unique(tokens).slice(0, 5) };
}

function topKeywordsForGroup(group: GroupRecord, extraTokens: string[]): string[] {
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
  let best: { key: DiaryCategoryKey; score: number } = { key: "news", score: 0 };

  for (const key of candidates) {
    const meta = CATEGORY_META[key];
    const score =
      meta.keywords.filter((keyword) => lower.includes(keyword)).length +
      meta.domains.filter((domainPattern) => lower.includes(domainPattern)).length * 2;
    if (score > best.score) best = { key, score };
  }

  return best.score > 0 ? best.key : "news";
}

function buildRuleBasedEntry(day: DiaryDay): Pick<DiaryEntry, "summary" | "body" | "tags"> {
  const topGroups = day.topGroups.slice(0, 3);
  const topKeywords = day.topKeywords.slice(0, 5);
  const main = topGroups[0]?.label ?? topKeywords[0] ?? "디지털 기록";
  const secondary = topGroups[1]?.label;
  const summary = secondary
    ? `"${main}에서 시작해,\n${secondary}까지 이어진 하루."`
    : `"${main} 쪽으로\n조용히 기울어진 하루."`;
  const domains = day.topDomains.slice(0, 3).map((d) => d.domain).join(", ");
  const bodyParts = [
    `${formatKoreanDate(day.dateKey)}에는 ${main} 관련 기록이 가장 많이 남았어요.`,
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

const RAG_RECENT_DAYS = 14;
const RAG_TOP_K = 2;
const RAG_MIN_SIMILARITY = 0.78;

// 로컬 LLM (Ollama + EXAONE). 생성이 기기 안에서 처리됨 — 외부 전송 0%
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "exaone3.5:7.8b";

function buildMemoryQuery(day: DiaryDay): string {
  const groups = day.topGroups.map((group) => group.label).join(" ");
  const keywords = day.topKeywords.slice(0, 8).join(" ");
  const titles = day.episodes
    .filter((episode) => !episode.isSensitive)
    .slice(0, 6)
    .map((episode) => episode.title)
    .join(" ");
  return [groups, keywords, titles].filter(Boolean).join(" ").trim();
}

function formatMemory(entry: DiaryEntry): string {
  const summary = entry.summary.replace(/["\n]/g, " ").trim();
  const body = entry.body.replace(/\s+/g, " ").trim();
  return `${formatKoreanDate(entry.dateKey)}: ${summary} ${body}`.slice(0, 240);
}

// 오늘 활동을 쿼리로, 과거 일기를 코퍼스로 삼아 RAG 검색 (e5 코사인 → 키워드 폴백)
async function retrieveDiaryMemories(
  day: DiaryDay,
  target: string,
): Promise<string[]> {
  const entries = await getAllDiaryEntries();
  const past = Object.values(entries)
    .filter((entry) => entry.dateKey < target)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1))
    .slice(0, RAG_RECENT_DAYS);
  const queryText = buildMemoryQuery(day);
  if (past.length === 0 || !queryText) return [];

  try {
    const queryVec = await embedText(E5_QUERY_PREFIX + queryText);
    const scored = await Promise.all(
      past.map(async (entry) => ({
        entry,
        score: cosineSimilarity(
          queryVec,
          await embedText(E5_PASSAGE_PREFIX + formatMemory(entry)),
        ),
      })),
    );
    const top = scored
      .filter((item) => item.score >= RAG_MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, RAG_TOP_K);
    if (top.length > 0) return top.map((item) => formatMemory(item.entry));
  } catch (err) {
    console.warn("[auto-tab-group] diary RAG 임베딩 실패 → 키워드 폴백", err);
  }

  // 폴백: 쿼리와 과거 일기 토큰 겹침 상위 K개
  const queryTokens = new Set(tokenize(queryText));
  return past
    .map((entry) => {
      const tokens = tokenize(
        `${entry.summary} ${entry.body} ${entry.tags.join(" ")}`,
      );
      let overlap = 0;
      for (const token of tokens) if (queryTokens.has(token)) overlap += 1;
      return { entry, overlap };
    })
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, RAG_TOP_K)
    .map((item) => formatMemory(item.entry));
}

const DIARY_PROFILE = {
  name: "나",
  persona: "개발과 AI를 공부하는 사람",
  tone: "담백하고 솔직한 반말체",
} as const;

function categoryDistribution(episodes: DiaryEpisode[]): string {
  const counts = new Map<DiaryCategoryKey, number>();
  for (const ep of episodes) {
    counts.set(ep.categoryKey, (counts.get(ep.categoryKey) ?? 0) + 1);
  }
  const total = episodes.length || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(
      ([key, n]) =>
        `${CATEGORY_META[key].label} ${Math.round((n / total) * 100)}%`,
    )
    .join(", ");
}

// 한결식 상세 프롬프트 — 역할·페르소나·작법 가이드 + RAG 맥락
function buildDiaryPrompt(day: DiaryDay, memories: string[]): string {
  const safeEpisodes = day.episodes.filter((episode) => !episode.isSensitive);
  const list = safeEpisodes
    .slice(0, 20)
    .map((ep) => `- ${ep.title} · ${CATEGORY_META[ep.categoryKey].label}`)
    .join("\n");
  const catLine = categoryDistribution(safeEpisodes);
  const ragBlock =
    memories.length > 0
      ? "\n# 지난 며칠의 기록 (참고용)\n" +
        memories.map((m) => "- " + m).join("\n") +
        "\n오늘과 자연스럽게 이어지는 흐름이 보이면 한 번 짚어줘도 좋아. 단, 억지로 끌어오지는 마.\n"
      : "";
  return `# 역할
너는 ${DIARY_PROFILE.name}의 하루를 대신 적어주는 일기 작가다. 활동 로그 요약이나 보고서가 아니라, 직접 펜을 든 것처럼 쓰는 한 편의 일기다.

# ${DIARY_PROFILE.name}에 대하여
${DIARY_PROFILE.persona}. 일기 말투는 ${DIARY_PROFILE.tone}로, 처음부터 끝까지 일관되게.

# 오늘(${formatKoreanDate(day.dateKey)}) 모인 활동
${list}
관심 분포 — ${catLine}
민감한 활동은 이미 제외됐다. 목록에 없는 일을 지어내지 마라.
${ragBlock}
# 쓰는 방법
- 1인칭 '나' 시점, 세 문단. 각 문단 3~4문장.
- 활동을 나열하지 마라. '무엇을 했나'가 아니라 '그 시간이 어떻게 흘렀고 무엇이 남았나'를 써라.
- 서비스·도구 이름은 꼭 필요할 때만 한두 개. "GitHub에서 PR을 봤다"보다 "막힌 코드를 한참 붙들고 있었다"에 가깝게.
- 하루의 리듬(아침 → 낮 → 저녁)이나 마음의 결을 따라 자연스럽게 이어라.
- 과장, 억지 교훈, 작위적 마무리 금지. 담담하게 끝나도 좋다.

# summary
그날 전체를 관통하는 한 문장. 큰따옴표로 감싼다. 활동 요약이 아니라 그날의 정수.
예) "막힌 걸 풀어낸 감각으로 하루가 흘러갔다."

# tags
오늘을 대표하는 2~4개. 활동 묶음이나 그날의 분위기. 반드시 한국어로 쓴다.

# 출력
아래 JSON만 출력하라. 다른 텍스트는 절대 쓰지 마라.
{"summary":"...","body":"첫 문단\\n\\n둘째 문단\\n\\n셋째 문단","tags":["...","..."]}`;
}

async function generateWithLocalLLM(
  day: DiaryDay,
  memories: string[] = [],
): Promise<Pick<DiaryEntry, "summary" | "body" | "tags"> | null> {
  const safeEpisodes = day.episodes.filter((episode) => !episode.isSensitive);
  if (safeEpisodes.length === 0) return null;

  const prompt = buildDiaryPrompt(day, memories);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: "json", // 유효한 JSON만 출력하도록 강제
        options: { temperature: 0.8 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    const parsed = parseJsonObject(data.response ?? "");
    if (!parsed) return null;
    return {
      summary: String(parsed.summary ?? ""),
      body: String(parsed.body ?? ""),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map(String).slice(0, 6)
        : day.topKeywords.slice(0, 4),
    };
  } catch (err) {
    console.warn("[auto-tab-group] diary local LLM generation failed", err);
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
      title: main ? `${main.label} 흐름을 이어가보세요` : "오늘의 기록을 더 모아보세요",
      body: main
        ? `${main.count}개의 기록이 이 주제에 모였어요. 다음에는 관련 문서나 작업 결과를 하나로 정리해볼 만합니다.`
        : "방문 기록이 쌓이면 관심 흐름을 더 선명하게 보여드릴 수 있어요.",
      tags: main?.keywords.slice(0, 3) ?? kw,
    },
    {
      title: second ? `${second.label}도 함께 자라고 있어요` : "반복 키워드를 살펴보세요",
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
  const dow = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][
    d.getDay()
  ];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${dow}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
