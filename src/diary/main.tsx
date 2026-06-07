import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  BackfillHistoryResponse,
  GenerateDiaryEntryResponse,
  GetDiaryAnalysisResponse,
  GetDiaryDayResponse,
  GetDiarySettingsResponse,
  GetDiaryWeekResponse,
} from "@/shared/messages";
import type {
  DiaryAnalysis,
  DiaryCategoryKey,
  DiaryDay,
  DiaryEpisode,
  DiarySettings,
  DiaryWeek,
} from "@/shared/types";
import aliceUrl from "./assets/alice.png";
import rabbitUrl from "./assets/rabbit.png";
import timelinePathUrl from "./assets/timeline-path.png";

type ViewKey = "entry" | "timeline" | "board" | "analysis";

const CATEGORY_LABELS: Record<DiaryCategoryKey, string> = {
  dev: "AI · 개발",
  ent: "영상 · 엔터",
  news: "뉴스 · 정보",
  life: "요리 · 라이프",
  sens: "민감",
};

const CATEGORY_COLORS: Record<DiaryCategoryKey, string> = {
  dev: "#6B3FA0",
  ent: "#F0A8C0",
  news: "#A8C8E8",
  life: "#A8D8B8",
  sens: "#E8C090",
};

function todayKey(): string {
  return dateKey(Date.now());
}

function dateKey(timestamp: number): string {
  const d = new Date(timestamp);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shortDate(key: string): string {
  const d = parseDateKey(key);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dayName(key: string): string {
  return ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][
    parseDateKey(key).getDay()
  ];
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function addDays(key: string, offset: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + offset);
  return dateKey(d.getTime());
}

function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>("entry");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [day, setDay] = useState<DiaryDay | null>(null);
  const [week, setWeek] = useState<DiaryWeek | null>(null);
  const [analysis, setAnalysis] = useState<DiaryAnalysis | null>(null);
  const [settings, setSettings] = useState<DiarySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("불러오는 중");
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  useEffect(() => {
    void initialLoad();
  }, []);

  useEffect(() => {
    void loadDate(selectedDate);
  }, [selectedDate]);

  async function initialLoad(): Promise<void> {
    setBusy(true);
    try {
      const st = (await chrome.runtime.sendMessage({
        type: "GET_DIARY_SETTINGS",
      })) as GetDiarySettingsResponse;
      setSettings(st.settings);
      setApiKeyDraft(st.settings.geminiApiKey);
      const res = (await chrome.runtime.sendMessage({
        type: "BACKFILL_HISTORY",
        days: st.settings.backfillDays,
      })) as BackfillHistoryResponse;
      setStatus(`히스토리 ${res.importedCount}개 반영`);
      await loadDate(selectedDate);
    } finally {
      setBusy(false);
    }
  }

  async function loadDate(target: string): Promise<void> {
    const [dayRes, weekRes, analysisRes] = await Promise.all([
      chrome.runtime.sendMessage({
        type: "GET_DIARY_DAY",
        dateKey: target,
      }) as Promise<GetDiaryDayResponse>,
      chrome.runtime.sendMessage({
        type: "GET_DIARY_WEEK",
        dateKey: target,
      }) as Promise<GetDiaryWeekResponse>,
      chrome.runtime.sendMessage({
        type: "GET_DIARY_ANALYSIS",
        dateKey: target,
      }) as Promise<GetDiaryAnalysisResponse>,
    ]);
    setDay(dayRes.day);
    setWeek(weekRes.week);
    setAnalysis(analysisRes.analysis);
    setStatus("로컬 저장 중");
  }

  async function generateEntry(): Promise<void> {
    setBusy(true);
    setStatus("일기 생성 중");
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "GENERATE_DIARY_ENTRY",
        dateKey: selectedDate,
      })) as GenerateDiaryEntryResponse;
      setDay((prev) => (prev ? { ...prev, entry: res.entry } : prev));
      setStatus("일기 생성 완료");
    } finally {
      setBusy(false);
    }
  }

  async function saveDiarySettings(): Promise<void> {
    const res = (await chrome.runtime.sendMessage({
      type: "UPDATE_DIARY_SETTINGS",
      settings: { geminiApiKey: apiKeyDraft.trim() },
    })) as { ok: boolean; settings: DiarySettings };
    setSettings(res.settings);
    setStatus("설정 저장 완료");
  }

  const railDates = useMemo(() => {
    if (week) return week.days.map((d) => d.dateKey);
    return [-3, -2, -1, 0].map((offset) => addDays(selectedDate, offset));
  }, [selectedDate, week]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="logo" onClick={() => setView("entry")}>
          diary
        </button>
        <nav className="tabs" aria-label="주요 메뉴">
          <button
            className={`tab ${view === "entry" ? "on" : ""}`}
            onClick={() => setView("entry")}
          >
            일기
          </button>
          <button
            className={`tab ${view === "timeline" ? "on" : ""}`}
            onClick={() => setView("timeline")}
          >
            타임라인
          </button>
          <button
            className={`tab ${view === "board" ? "on" : ""}`}
            onClick={() => setView("board")}
          >
            보드
          </button>
          <button
            className={`tab ${view === "analysis" ? "on" : ""}`}
            onClick={() => setView("analysis")}
          >
            분석
          </button>
        </nav>
        <div className="status">
          <span className="dot" />
          {busy ? "작업 중" : status}
        </div>
      </header>

      {view === "entry" && day && (
        <EntryView
          day={day}
          railDates={railDates}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onPrev={() => setSelectedDate(addDays(selectedDate, -1))}
          onNext={() => setSelectedDate(addDays(selectedDate, 1))}
          onGenerate={generateEntry}
          busy={busy}
        />
      )}
      {view === "timeline" && day && (
        <TimelineView
          day={day}
          railDates={railDates}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      )}
      {view === "board" && week && (
        <BoardView
          week={week}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      )}
      {view === "analysis" && analysis && (
        <AnalysisView
          analysis={analysis}
          settings={settings}
          apiKeyDraft={apiKeyDraft}
          onApiKeyDraft={setApiKeyDraft}
          onSaveSettings={saveDiarySettings}
        />
      )}
    </div>
  );
}

function EntryView(props: {
  day: DiaryDay;
  railDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onGenerate: () => void;
  busy: boolean;
}): JSX.Element {
  const { day } = props;
  const categoryTotal = Math.max(1, day.episodes.length);
  const categoryCounts = countCategories(day.episodes);
  const entry = day.entry;

  return (
    <main className="stage entry-stage">
      <DateRail
        dates={props.railDates}
        selectedDate={props.selectedDate}
        onSelectDate={props.onSelectDate}
      />
      <div className="book-wrap">
        <button className="arrow" onClick={props.onPrev} aria-label="이전 날">
          ‹
        </button>
        <section className="book">
          <div className="face left">
            <div className="l-datebig">{shortDate(day.dateKey)}</div>
            <div className="l-dow">{dayName(day.dateKey)}</div>
            <div className="l-summary">
              {entry?.summary ?? `"${day.topGroups[0]?.label ?? "오늘"}"\n기록을 모으는 중.`}
            </div>
            <div className="l-block">
              <div className="l-label">Auto Tab Group keywords</div>
              <div className="l-meta">
                <div className="l-stat">
                  <b>{day.stats.totalEpisodes}</b>
                  <span>기록</span>
                </div>
                <div className="l-stat">
                  <b>{day.stats.activeMinutes}</b>
                  <span>분</span>
                </div>
                <div className="l-stat">
                  <b>{day.stats.sensitiveEpisodes}</b>
                  <span>민감 제외</span>
                </div>
              </div>
              <div className="cat-bar">
                {Object.entries(categoryCounts).map(([key, count]) => (
                  <span
                    key={key}
                    className="cat-seg"
                    style={{
                      width: `${(count / categoryTotal) * 100}%`,
                      background: CATEGORY_COLORS[key as DiaryCategoryKey],
                    }}
                  />
                ))}
              </div>
              <div className="cat-legend">
                {Object.entries(categoryCounts).map(([key, count]) => (
                  <span key={key} className="cat-leg">
                    <span
                      className="d"
                      style={{
                        background: CATEGORY_COLORS[key as DiaryCategoryKey],
                      }}
                    />
                    {CATEGORY_LABELS[key as DiaryCategoryKey]} {count}
                  </span>
                ))}
              </div>
              <div className="domains">
                {day.topDomains.map((domain) => (
                  <span key={domain.domain} className="dom">
                    {domain.domain}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="face right">
            {day.stats.totalEpisodes === 0 ? (
              <EmptyDay />
            ) : entry ? (
              <>
                <div className="r-head">오늘의 일기</div>
                <div className="r-body">{entry.body}</div>
                <div className="tags">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">
                <div className="empty-mark">✎</div>
                <div className="empty-title">아직 일기가 없어요.</div>
                <div className="empty-sub">
                  Auto Tab Group이 모은 {day.stats.safeEpisodes}개의 안전한
                  기록으로 하루를 글로 만들 수 있어요.
                </div>
                <button
                  className="btn-make"
                  onClick={props.onGenerate}
                  disabled={props.busy}
                >
                  {props.busy ? "생성 중..." : "오늘의 일기 만들기"}
                </button>
              </div>
            )}
          </div>
        </section>
        <button className="arrow" onClick={props.onNext} aria-label="다음 날">
          ›
        </button>
      </div>
      <div className="hint">
        탭 자동 그룹화에서 나온 라벨과 키워드가 하루의 문장으로 이어집니다
      </div>
    </main>
  );
}

function TimelineView(props: {
  day: DiaryDay;
  railDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}): JSX.Element {
  const bins = buildTimelineBins(props.day.episodes);
  const max = Math.max(1, ...bins.map((bin) => bin.count));

  return (
    <main className="timeline-wrap">
      <div className="section-head">
        <div>
          <h1>{shortDate(props.day.dateKey)} {dayName(props.day.dateKey)}</h1>
          <p>방문 밀도와 Auto Tab Group 주제를 시간순으로 봅니다.</p>
        </div>
      </div>
      <DateRail
        dates={props.railDates}
        selectedDate={props.selectedDate}
        onSelectDate={props.onSelectDate}
      />
      <div className="timeline-stage">
        <img src={timelinePathUrl} alt="" />
        <img className="alice" src={aliceUrl} alt="" />
        <img className="rabbit" src={rabbitUrl} alt="" />
      </div>
      <section className="density-card">
        <div className="density">
          {bins.map((bin) => (
            <div
              key={bin.hour}
              className="db"
              style={{
                height: `${Math.max(4, (bin.count / max) * 100)}%`,
                background: bin.color,
              }}
              title={`${bin.hour}:00 · ${bin.count}개`}
            />
          ))}
        </div>
        <div className="xrow">
          {bins.map((bin) => (
            <span key={bin.hour}>{bin.hour % 3 === 0 ? `${bin.hour}:00` : ""}</span>
          ))}
        </div>
      </section>
      <EpisodeList episodes={props.day.episodes} />
    </main>
  );
}

function BoardView(props: {
  week: DiaryWeek;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}): JSX.Element {
  return (
    <main className="board-wrap">
      <div className="section-head">
        <div>
          <h1>이번 주의 흐름</h1>
          <p>
            {shortDate(props.week.startDateKey)} – {shortDate(props.week.endDateKey)}
          </p>
        </div>
      </div>
      <div className="legend">
        {(Object.keys(CATEGORY_LABELS) as DiaryCategoryKey[]).map((key) => (
          <span key={key} className="leg">
            <span className="d" style={{ background: CATEGORY_COLORS[key] }} />
            {CATEGORY_LABELS[key]}
          </span>
        ))}
      </div>
      <div className="board">
        {props.week.days.map((day) => (
          <button
            key={day.dateKey}
            className={`col ${day.dateKey === props.selectedDate ? "today" : ""}`}
            onClick={() => props.onSelectDate(day.dateKey)}
          >
            <div className="col-head">
              <div className="col-day">{day.label.split(" ")[0]}</div>
              <div className="col-dow">{day.label.split(" ")[1]}</div>
              <div className="col-count">{day.stats.totalEpisodes}개</div>
            </div>
            {day.topGroups.length === 0 ? (
              <div className="col-empty">기록 없음</div>
            ) : (
              day.topGroups.slice(0, 5).map((group) => (
                <div
                  key={`${day.dateKey}:${group.groupKey ?? group.label}`}
                  className={`note ${group.categoryKey === "sens" ? "sens" : ""}`}
                  style={{
                    borderLeftColor: CATEGORY_COLORS[group.categoryKey],
                  }}
                >
                  <span
                    className="nk"
                    style={{ color: CATEGORY_COLORS[group.categoryKey] }}
                  >
                    {CATEGORY_LABELS[group.categoryKey]}
                  </span>
                  {group.label} {group.count > 1 ? `외 ${group.count - 1}건` : ""}
                </div>
              ))
            )}
          </button>
        ))}
      </div>
    </main>
  );
}

function AnalysisView(props: {
  analysis: DiaryAnalysis;
  settings: DiarySettings | null;
  apiKeyDraft: string;
  onApiKeyDraft: (value: string) => void;
  onSaveSettings: () => void;
}): JSX.Element {
  const total = Math.max(
    1,
    props.analysis.topGroups.reduce((sum, group) => sum + group.count, 0),
  );

  return (
    <main className="analysis-wrap">
      <section className="analysis-hero">
        <div>
          <div className="kicker">이번 주의 너</div>
          <h1>
            {props.analysis.topGroups[0]?.label ?? "기록"}을
            <br />
            따라간 한 주.
          </h1>
          <p>
            Auto Tab Group이 반복해서 묶은 라벨과 키워드로 관심 흐름을
            계산했습니다.
          </p>
        </div>
      </section>
      <div className="analysis-grid">
        <section className="glass">
          <div className="sec-k">관심 분야</div>
          {props.analysis.topGroups.map((group) => (
            <div key={group.groupKey ?? group.label} className="int-row">
              <div className="int-top">
                <span className="int-name">
                  <span
                    className="int-dot"
                    style={{ background: CATEGORY_COLORS[group.categoryKey] }}
                  />
                  {group.label}
                </span>
                <b>{Math.round((group.count / total) * 100)}%</b>
              </div>
              <div className="int-track">
                <span
                  style={{
                    width: `${(group.count / total) * 100}%`,
                    background: CATEGORY_COLORS[group.categoryKey],
                  }}
                />
              </div>
            </div>
          ))}
        </section>
        <section className="glass">
          <div className="sec-k">자주 등장한 키워드</div>
          <div className="keywords">
            {props.analysis.topKeywords.slice(0, 18).map((item, idx) => (
              <span
                key={item.keyword}
                className="wc"
                style={{ fontSize: `${32 - Math.min(idx, 10)}px` }}
              >
                {item.keyword}
              </span>
            ))}
          </div>
        </section>
        <section className="glass span2">
          <div className="sec-k">다음 시도해볼 방향</div>
          {props.analysis.recommendations.map((rec) => (
            <article key={rec.title} className="rec">
              <div className="rec-title">{rec.title}</div>
              <p>{rec.body}</p>
              <div className="rec-tags">
                {rec.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </section>
        <section className="glass span2 settings-panel">
          <div>
            <div className="sec-k">LLM 설정</div>
            <p>
              키가 없으면 키워드 기반 규칙형 일기를 만들고, 키가 있으면 민감
              항목을 제외한 요약 재료만 Gemini로 보냅니다.
            </p>
          </div>
          <input
            type="password"
            value={props.apiKeyDraft}
            placeholder="Gemini API key"
            onChange={(event) => props.onApiKeyDraft(event.target.value)}
          />
          <button onClick={props.onSaveSettings}>
            {props.settings?.geminiApiKey ? "키 업데이트" : "키 저장"}
          </button>
        </section>
      </div>
    </main>
  );
}

function DateRail(props: {
  dates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}): JSX.Element {
  return (
    <div className="rail">
      {props.dates.map((date) => (
        <button
          key={date}
          className={`rail-chip ${date === props.selectedDate ? "on" : ""}`}
          onClick={() => props.onSelectDate(date)}
        >
          {shortDate(date)} {dayName(date).slice(0, 1)}
        </button>
      ))}
    </div>
  );
}

function EmptyDay(): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-mark">·</div>
      <div className="empty-title">아직 기록이 없습니다.</div>
      <div className="empty-sub">
        최근 히스토리나 새 탭 분류가 쌓이면 이 페이지가 자동으로 채워집니다.
      </div>
    </div>
  );
}

function EpisodeList(props: { episodes: DiaryEpisode[] }): JSX.Element {
  if (props.episodes.length === 0) {
    return <div className="dcard empty-card">이 날짜에는 기록이 없습니다.</div>;
  }

  return (
    <section className="dcard episode-card">
      {props.episodes.map((episode) => (
        <article key={episode.id} className="pitem">
          <div className="ptime">{timeLabel(episode.startedAt)}</div>
          <div className="pbody">
            <div className="ptitle">{episode.title || episode.domain}</div>
            <div className="purl">{episode.domain}</div>
            <div className="pmeta">
              <span
                className="ptag"
                style={{ background: `${CATEGORY_COLORS[episode.categoryKey]}33` }}
              >
                {episode.isSensitive ? "민감 · 가림" : episode.groupLabel}
              </span>
              {episode.keywords.slice(0, 3).map((keyword) => (
                <span key={keyword} className="pdur">
                  #{keyword}
                </span>
              ))}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function countCategories(
  episodes: DiaryEpisode[],
): Partial<Record<DiaryCategoryKey, number>> {
  const counts: Partial<Record<DiaryCategoryKey, number>> = {};
  for (const episode of episodes) {
    counts[episode.categoryKey] = (counts[episode.categoryKey] ?? 0) + 1;
  }
  return counts;
}

function buildTimelineBins(episodes: DiaryEpisode[]): Array<{
  hour: number;
  count: number;
  color: string;
}> {
  const bins = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: 0,
    category: "news" as DiaryCategoryKey,
  }));
  for (const episode of episodes) {
    const hour = new Date(episode.startedAt).getHours();
    bins[hour].count += 1;
    bins[hour].category = episode.categoryKey;
  }
  return bins.map((bin) => ({
    hour: bin.hour,
    count: bin.count,
    color: bin.count > 0 ? CATEGORY_COLORS[bin.category] : "#F0E8F8",
  }));
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
