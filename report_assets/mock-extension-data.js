const now = Date.now();
const today = new Date();
const dateKey = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

const sampleGroups = [
  {
    groupKey: "g-dev",
    chromeGroupId: 1,
    centroid: [],
    docCount: 4,
    documents: [],
    label: "AI 개발",
    color: "purple",
    createdAt: now - 3600000,
    updatedAt: now - 900000,
    lastActiveAt: now - 900000,
    domains: { "github.com": 2, "chatgpt.com": 1, "developer.chrome.com": 1 },
  },
  {
    groupKey: "g-research",
    chromeGroupId: 2,
    centroid: [],
    docCount: 3,
    documents: [],
    label: "논문 조사",
    color: "cyan",
    createdAt: now - 7200000,
    updatedAt: now - 1800000,
    lastActiveAt: now - 1800000,
    domains: { "dl.acm.org": 1, "arxiv.org": 1, "semanticscholar.org": 1 },
  },
];

const sampleEpisodes = [
  {
    id: "e1",
    dateKey,
    startedAt: now - 7200000,
    durationMs: 1800000,
    durationSource: "estimated",
    title: "Chrome Extension Manifest V3 문서 확인",
    url: "https://developer.chrome.com/docs/extensions",
    domain: "developer.chrome.com",
    snippet: "서비스 워커와 content script 구조를 검토함.",
    groupKey: "g-dev",
    groupLabel: "AI 개발",
    keywords: ["extension", "manifest", "service-worker"],
    tokens: ["extension", "manifest", "service-worker"],
    categoryKey: "dev",
    isSensitive: false,
    source: "classified-tab",
    createdAt: now - 7200000,
    updatedAt: now - 7200000,
  },
  {
    id: "e2",
    dateKey,
    startedAt: now - 4800000,
    durationMs: 1500000,
    durationSource: "estimated",
    title: "웹 본문 추출 논문 조사",
    url: "https://dl.acm.org/",
    domain: "dl.acm.org",
    snippet: "Readability와 Trafilatura 성능 비교 자료를 정리함.",
    groupKey: "g-research",
    groupLabel: "논문 조사",
    keywords: ["readability", "trafilatura", "extraction"],
    tokens: ["readability", "trafilatura", "extraction"],
    categoryKey: "news",
    isSensitive: false,
    source: "classified-tab",
    createdAt: now - 4800000,
    updatedAt: now - 4800000,
  },
  {
    id: "e3",
    dateKey,
    startedAt: now - 2700000,
    durationMs: 1200000,
    durationSource: "estimated",
    title: "ChatGPT 대화 기반 요약 테스트",
    url: "https://chatgpt.com/",
    domain: "chatgpt.com",
    snippet: "수집된 탭 그룹을 일기 초안으로 전환하는 문장을 테스트함.",
    groupKey: "g-dev",
    groupLabel: "AI 개발",
    keywords: ["chatgpt", "summary", "diary"],
    tokens: ["chatgpt", "summary", "diary"],
    categoryKey: "dev",
    isSensitive: false,
    source: "classified-tab",
    createdAt: now - 2700000,
    updatedAt: now - 2700000,
  },
];

const sampleDay = {
  dateKey,
  episodes: sampleEpisodes,
  topKeywords: ["extension", "readability", "diary", "classification"],
  topGroups: [
    { groupKey: "g-dev", label: "AI 개발", count: 2, keywords: ["extension", "diary"], categoryKey: "dev" },
    { groupKey: "g-research", label: "논문 조사", count: 1, keywords: ["readability"], categoryKey: "news" },
  ],
  topDomains: [
    { domain: "developer.chrome.com", count: 1 },
    { domain: "chatgpt.com", count: 1 },
    { domain: "dl.acm.org", count: 1 },
  ],
  stats: { totalEpisodes: 3, safeEpisodes: 3, sensitiveEpisodes: 0, activeMinutes: 75 },
  entry: {
    dateKey,
    summary: "확장 프로그램 구조와 웹 본문 추출 방법을 검토하며 Diary Journey의 핵심 파이프라인을 정리한 하루.",
    body: "오늘은 Chrome Extension 기반 구현 구조를 점검하고, 웹 페이지의 핵심 내용을 추출하는 방법을 논문과 코드 양쪽에서 비교했다. 오후에는 수집된 활동을 탭 그룹과 일기 초안으로 연결하는 흐름을 확인했다.",
    tags: ["ChromeExtension", "본문추출", "DiaryJourney"],
    sourceEpisodeIds: ["e1", "e2", "e3"],
    createdAt: now,
    updatedAt: now,
  },
};

const sampleWeek = {
  startDateKey: dateKey,
  endDateKey: dateKey,
  days: [
    { dateKey, label: "오늘", stats: sampleDay.stats, topGroups: sampleDay.topGroups, topKeywords: sampleDay.topKeywords },
  ],
};

window.chrome = {
  runtime: {
    getURL: (path) => path,
    openOptionsPage: () => {},
    sendMessage: async (message) => {
      switch (message.type) {
        case "GET_GROUPS":
          return { type: "GET_GROUPS_RESULT", groups: sampleGroups };
        case "GET_SETTINGS":
          return {
            type: "GET_SETTINGS_RESULT",
            settings: {
              enabled: true,
              threshold: 0.75,
              contentExtractionEnabled: true,
              maxDocsPerGroup: 50,
              reclassifyMinChars: 200,
              keepThreshold: 0.68,
              urlChangeReclassifyEnabled: true,
              groupMergeEnabled: true,
            },
          };
        case "GET_SUMMARY":
          return {
            type: "GET_SUMMARY_RESULT",
            summary: {
              totalGroups: 2,
              totalDocuments: 7,
              lastUpdatedAt: now - 300000,
              topKeywords: ["extension", "readability", "diary", "classification"],
              groups: [
                { groupKey: "g-dev", label: "AI 개발", color: "purple", docCount: 4, topKeywords: ["extension", "diary"], topDomains: ["github.com", "chatgpt.com"], recentTitles: [], updatedAt: now },
                { groupKey: "g-research", label: "논문 조사", color: "cyan", docCount: 3, topKeywords: ["readability", "trafilatura"], topDomains: ["dl.acm.org"], recentTitles: [], updatedAt: now },
              ],
            },
          };
        case "GET_DIARY_SETTINGS":
          return { type: "GET_DIARY_SETTINGS_RESULT", settings: { collectionEnabled: true, sensitiveFilterEnabled: true, backfillDays: 7, geminiApiKey: "" } };
        case "BACKFILL_HISTORY":
          return { type: "BACKFILL_HISTORY_RESULT", importedCount: 3 };
        case "GET_DIARY_DAY":
          return { type: "GET_DIARY_DAY_RESULT", day: sampleDay };
        case "GET_DIARY_WEEK":
          return { type: "GET_DIARY_WEEK_RESULT", week: sampleWeek };
        case "GET_DIARY_ANALYSIS":
          return {
            type: "GET_DIARY_ANALYSIS_RESULT",
            analysis: {
              dateKey,
              week: sampleWeek,
              topKeywords: sampleDay.topKeywords.map((keyword, index) => ({ keyword, count: 4 - index })),
              topGroups: sampleDay.topGroups,
              recommendations: [
                { title: "핵심 추출 기준 점검", body: "본문 추출 실패 사례를 수집해 confidence 기준을 보완한다.", tags: ["extraction"] },
              ],
            },
          };
        case "UPDATE_SETTINGS":
        case "UPDATE_DIARY_SETTINGS":
          return { ok: true, settings: {} };
        default:
          return { ok: true };
      }
    },
  },
  tabs: {
    create: async () => ({}),
  },
};
