import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CSSProperties } from "react";
import type {
  BackfillHistoryResponse,
  GenerateDiaryEntryResponse,
  GetDiaryAnalysisResponse,
  GetDiaryDayResponse,
  GetDiarySettingsResponse,
  GetDiaryWeekResponse,
  SaveDiaryEntryResponse,
} from "@/shared/messages";
import type {
  DiaryAnalysis,
  DiaryCategoryKey,
  DiaryDay,
  DiaryEntry,
  DiaryEpisode,
  DiaryFontFamily,
  DiarySettings,
  DiaryTagNote,
  DiaryTextFormat,
  DiaryWeek,
} from "@/shared/types";
import aliceUrl from "./assets/alice.png";
import rabbitUrl from "./assets/rabbit.png";
import timelinePathUrl from "./assets/timeline-path.png";

type ViewKey = "entry" | "timeline" | "board" | "analysis";

type DiaryEntryPatch = {
  summary?: string;
  body?: string;
  bodyHtml?: string;
  tags?: string[];
  format?: DiaryTextFormat;
  tagNotes?: Record<string, DiaryTagNote>;
};

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

const DEFAULT_ENTRY_FORMAT: DiaryTextFormat = {
  fontFamily: "system",
  fontSize: 15,
  textColor: "#5a4570",
};

const FONT_STYLE_MAP: Record<DiaryFontFamily, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  serif: 'Georgia, "Noto Serif KR", serif',
  gothic: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
  handwriting: '"Segoe Print", "Nanum Pen Script", cursive',
  mono: '"JetBrains Mono", "Consolas", monospace',
};

const FONT_COMMAND_MAP: Record<DiaryFontFamily, string> = {
  system: "Segoe UI",
  serif: "Georgia",
  gothic: "Malgun Gothic",
  handwriting: "Segoe Print",
  mono: "Consolas",
};

const COLOR_PRESETS = [
  "#3d2459",
  "#1a1a2e",
  "#4a4a4a",
  "#6b3fa0",
  "#5c3d2e",
  "#1e3a5f",
  "#166534",
  "#991b1b",
];

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
  const latestDateRequest = useRef(0);

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
    const requestId = latestDateRequest.current + 1;
    latestDateRequest.current = requestId;
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
    if (requestId !== latestDateRequest.current) return;
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

  async function saveDiaryEntryPatch(
    dateKey: string,
    patch: DiaryEntryPatch,
  ): Promise<DiaryEntry> {
    try {
      latestDateRequest.current += 1;
      const response = (await chrome.runtime.sendMessage({
        type: "SAVE_DIARY_ENTRY",
        dateKey,
        patch,
      })) as SaveDiaryEntryResponse | { error?: string };
      if (
        !("type" in response) ||
        response.type !== "SAVE_DIARY_ENTRY_RESULT" ||
        !response.entry ||
        response.entry.dateKey !== dateKey
      ) {
        throw new Error(
          "error" in response && response.error
            ? response.error
            : "저장 응답을 확인할 수 없습니다.",
        );
      }
      setDay((prev) =>
        prev?.dateKey === dateKey
          ? {
              ...prev,
              entry: response.entry,
            }
          : prev,
      );
      setStatus("일기 편집 저장 완료");
      return response.entry;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "알 수 없는 오류";
      setStatus(`일기 저장 실패: ${message}`);
      throw error;
    }
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
          onSaveEntry={saveDiaryEntryPatch}
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
  onSaveEntry: (
    dateKey: string,
    patch: DiaryEntryPatch,
  ) => Promise<DiaryEntry>;
  busy: boolean;
}): JSX.Element {
  const { day } = props;
  const categoryTotal = Math.max(1, day.episodes.length);
  const categoryCounts = countCategories(day.episodes);
  const entry = day.entry;

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [bodyHtmlDraft, setBodyHtmlDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [formatDraft, setFormatDraft] =
    useState<DiaryTextFormat>(DEFAULT_ENTRY_FORMAT);
  const selectedBodyRange = useRef<Range | null>(null);

  useEffect(() => {
    if (!entry || isEditing) return;
    setBodyDraft(entry.body);
    setBodyHtmlDraft(entry.bodyHtml ?? plainTextToHtml(entry.body));
    setTagsDraft(entry.tags);
    setFormatDraft(entry.format ?? DEFAULT_ENTRY_FORMAT);
  }, [entry, isEditing]);

  useEffect(() => {
    setIsEditing(false);
    setIsSaving(false);
  }, [day.dateKey]);

  function startEdit(): void {
    if (!entry) return;
    setBodyDraft(entry.body);
    setBodyHtmlDraft(entry.bodyHtml ?? plainTextToHtml(entry.body));
    setTagsDraft(entry.tags);
    setFormatDraft(entry.format ?? DEFAULT_ENTRY_FORMAT);
    setIsEditing(true);
  }

  function cancelEdit(): void {
    setIsEditing(false);
    if (!entry) return;
    setBodyDraft(entry.body);
    setBodyHtmlDraft(entry.bodyHtml ?? plainTextToHtml(entry.body));
    setTagsDraft(entry.tags);
    setFormatDraft(entry.format ?? DEFAULT_ENTRY_FORMAT);
  }

  async function saveEdit(): Promise<void> {
    if (!entry) return;
    setIsSaving(true);
    try {
      const savedEntry = await props.onSaveEntry(entry.dateKey, {
        body: bodyDraft,
        bodyHtml: sanitizeBodyHtml(bodyHtmlDraft),
        tags: tagsDraft,
        format: formatDraft,
      });
      setBodyDraft(savedEntry.body);
      setBodyHtmlDraft(savedEntry.bodyHtml ?? plainTextToHtml(savedEntry.body));
      setTagsDraft(savedEntry.tags);
      setFormatDraft(savedEntry.format ?? DEFAULT_ENTRY_FORMAT);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  const entryFormat = entry?.format ?? DEFAULT_ENTRY_FORMAT;

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
        <div className="entry-content-grid">
          <section className="book">
          <div className="face left">
            <div className="l-datebig">{shortDate(day.dateKey)}</div>
            <div className="l-dow">{dayName(day.dateKey)}</div>
            <div className="l-summary">
              {entry?.summary ??
                `"${day.topGroups[0]?.label ?? "오늘"}"\n기록을 모으는 중.`}
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
            {entry ? (
              <>
                <div className="r-head-row">
                  <div className="r-head">오늘의 일기</div>
                  {!isEditing && (
                    <button
                      type="button"
                      className="btn-edit"
                      data-testid="edit-diary-body"
                      onClick={startEdit}
                    >
                      본문 편집
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <>
                    <FormatToolbar
                      value={formatDraft}
                      onApplyFontFamily={(fontFamily) => {
                        applySelectionFormat(
                          selectedBodyRange.current,
                          "fontName",
                          FONT_COMMAND_MAP[fontFamily],
                        );
                      }}
                      onApplyFontSize={(fontSize) => {
                        applySelectionFontSize(
                          selectedBodyRange.current,
                          fontSize,
                        );
                      }}
                      onApplyTextColor={(color) => {
                        applySelectionFormat(
                          selectedBodyRange.current,
                          "foreColor",
                          color,
                        );
                      }}
                    />
                    <RichBodyEditor
                      html={bodyHtmlDraft}
                      onChange={(next) => {
                        setBodyDraft(next.text);
                        setBodyHtmlDraft(next.html);
                      }}
                      onSelectionChange={(range) => {
                        selectedBodyRange.current = range;
                      }}
                      style={{
                        fontFamily: FONT_STYLE_MAP[formatDraft.fontFamily],
                        fontSize: `${formatDraft.fontSize}px`,
                        color: formatDraft.textColor,
                      }}
                    />
                    <TagEditor tags={tagsDraft} onChange={setTagsDraft} />
                    <div className="edit-actions">
                      <button className="btn-cancel" onClick={cancelEdit}>
                        취소
                      </button>
                      <button
                        className="btn-save"
                        onClick={() => {
                          void saveEdit();
                        }}
                        disabled={isSaving}
                      >
                        {isSaving ? "저장 중..." : "저장"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className="r-body"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeBodyHtml(
                          entry.bodyHtml ?? plainTextToHtml(entry.body),
                        ),
                      }}
                      style={{
                        fontFamily: FONT_STYLE_MAP[entryFormat.fontFamily],
                        fontSize: `${entryFormat.fontSize}px`,
                        color: entryFormat.textColor,
                      }}
                    />
                    <div className="tags">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="tag">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : day.stats.totalEpisodes > 0 ? (
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
            ) : (
              <EmptyDay />
            )}
          </div>
          </section>
          <TagWorkspace
            day={day}
            entry={entry}
            onSaveEntry={props.onSaveEntry}
          />
        </div>
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

function TagWorkspace(props: {
  day: DiaryDay;
  entry: DiaryEntry | null;
  onSaveEntry: (dateKey: string, patch: DiaryEntryPatch) => Promise<DiaryEntry>;
}): JSX.Element {
  const tags = useMemo(
    () =>
      [
        ...new Set([
          ...(props.entry?.tags ?? []),
          ...props.day.topKeywords,
          ...props.day.episodes.flatMap((episode) => episode.keywords),
        ]),
      ].slice(0, 14),
    [props.day, props.entry],
  );
  const [selectedTag, setSelectedTag] = useState(tags[0] ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [bodyHtmlDraft, setBodyHtmlDraft] = useState("");
  const [formatDraft, setFormatDraft] =
    useState<DiaryTextFormat>(DEFAULT_ENTRY_FORMAT);
  const selectedRange = useRef<Range | null>(null);

  const relatedEpisodes = useMemo(
    () =>
      props.day.episodes.filter(
        (episode) =>
          !episode.isSensitive && episodeMatchesTag(episode, selectedTag),
      ),
    [props.day.episodes, selectedTag],
  );
  const generatedBody = useMemo(
    () => buildTagViewBody(selectedTag, relatedEpisodes),
    [relatedEpisodes, selectedTag],
  );
  const savedNote = selectedTag
    ? props.entry?.tagNotes?.[selectedTag]
    : undefined;
  const visibleBody = savedNote?.body ?? generatedBody;
  const visibleHtml =
    savedNote?.bodyHtml ?? plainTextToHtml(savedNote?.body ?? generatedBody);
  const visibleFormat = savedNote?.format ?? DEFAULT_ENTRY_FORMAT;

  useEffect(() => {
    if (!tags.includes(selectedTag)) setSelectedTag(tags[0] ?? "");
  }, [selectedTag, tags]);

  useEffect(() => {
    setIsEditing(false);
    setBodyDraft(visibleBody);
    setBodyHtmlDraft(visibleHtml);
    setFormatDraft(visibleFormat);
  }, [props.day.dateKey, selectedTag, savedNote?.updatedAt]);

  function startEdit(): void {
    if (!props.entry || !selectedTag) return;
    setBodyDraft(visibleBody);
    setBodyHtmlDraft(visibleHtml);
    setFormatDraft(visibleFormat);
    setIsEditing(true);
  }

  function cancelEdit(): void {
    setIsEditing(false);
    setBodyDraft(visibleBody);
    setBodyHtmlDraft(visibleHtml);
    setFormatDraft(visibleFormat);
  }

  async function saveEdit(): Promise<void> {
    if (!props.entry || !selectedTag) return;
    setIsSaving(true);
    try {
      const note: DiaryTagNote = {
        body: bodyDraft,
        bodyHtml: sanitizeBodyHtml(bodyHtmlDraft),
        format: formatDraft,
        updatedAt: Date.now(),
      };
      await props.onSaveEntry(props.entry.dateKey, {
        tagNotes: {
          ...(props.entry.tagNotes ?? {}),
          [selectedTag]: note,
        },
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <aside className="tag-workspace">
      <div className="tag-postits" aria-label="태그 포스트잇">
        {tags.length > 0 ? (
          tags.map((tag, index) => (
            <button
              key={tag}
              type="button"
              className={`tag-postit ${selectedTag === tag ? "on" : ""}`}
              style={
                {
                  "--postit-tilt": `${(index % 3) * 1.5 - 1.5}deg`,
                } as CSSProperties
              }
              onClick={() => setSelectedTag(tag)}
            >
              #{tag}
            </button>
          ))
        ) : (
          <span className="tag-postit-empty">수집된 태그가 없습니다.</span>
        )}
      </div>

      <section className="tag-view-page">
        <div className="tag-page-head">
          <div>
            <span className="tag-page-kicker">TAG VIEW</span>
            <h2>{selectedTag ? `#${selectedTag}` : "태그를 선택하세요"}</h2>
            <p>{relatedEpisodes.length}개의 관련 수집 내용</p>
          </div>
          {props.entry && selectedTag && !isEditing && (
            <button type="button" className="btn-edit" onClick={startEdit}>
              내용 편집
            </button>
          )}
        </div>

        {selectedTag &&
          (isEditing ? (
            <>
              <FormatToolbar
                value={formatDraft}
                onApplyFontFamily={(fontFamily) => {
                  applySelectionFormat(
                    selectedRange.current,
                    "fontName",
                    FONT_COMMAND_MAP[fontFamily],
                  );
                }}
                onApplyFontSize={(fontSize) => {
                  applySelectionFontSize(selectedRange.current, fontSize);
                }}
                onApplyTextColor={(color) => {
                  applySelectionFormat(
                    selectedRange.current,
                    "foreColor",
                    color,
                  );
                }}
              />
              <RichBodyEditor
                html={bodyHtmlDraft}
                onChange={(next) => {
                  setBodyDraft(next.text);
                  setBodyHtmlDraft(next.html);
                }}
                onSelectionChange={(range) => {
                  selectedRange.current = range;
                }}
                style={{
                  fontFamily: FONT_STYLE_MAP[formatDraft.fontFamily],
                  fontSize: `${formatDraft.fontSize}px`,
                  color: formatDraft.textColor,
                }}
              />
              <div className="edit-actions">
                <button className="btn-cancel" onClick={cancelEdit}>
                  취소
                </button>
                <button
                  className="btn-save"
                  onClick={() => void saveEdit()}
                  disabled={isSaving}
                >
                  {isSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="tag-note-body"
                dangerouslySetInnerHTML={{
                  __html: sanitizeBodyHtml(visibleHtml),
                }}
                style={{
                  fontFamily: FONT_STYLE_MAP[visibleFormat.fontFamily],
                  fontSize: `${visibleFormat.fontSize}px`,
                  color: visibleFormat.textColor,
                }}
              />
              <div className="tag-source-list">
                {relatedEpisodes.slice(0, 8).map((episode) => (
                  <span key={episode.id} title={episode.title}>
                    {episode.domain || episode.title}
                  </span>
                ))}
              </div>
              {!props.entry && (
                <p className="tag-edit-hint">
                  오늘의 일기를 만든 뒤 이 페이지도 편집해 저장할 수 있습니다.
                </p>
              )}
            </>
          ))}
      </section>
    </aside>
  );
}

function episodeMatchesTag(episode: DiaryEpisode, tag: string): boolean {
  const needle = normalizeTag(tag);
  if (!needle) return false;
  const values = [
    ...episode.keywords,
    ...episode.tokens,
    episode.groupLabel,
    episode.title,
    ...(episode.richContent?.facts ?? []).flatMap((fact) => [
      fact.subject,
      fact.detail,
    ]),
  ];
  return values.some((value) => normalizeTag(value).includes(needle));
}

function buildTagViewBody(tag: string, episodes: DiaryEpisode[]): string {
  if (!tag) return "";
  if (episodes.length === 0)
    return `#${tag}와 직접 연결된 수집 내용을 아직 찾지 못했습니다.`;

  const lines = [`#${tag} 관련 수집 내용`];
  const seenFacts = new Set<string>();
  for (const episode of episodes.slice(0, 10)) {
    const facts = episode.richContent?.facts ?? [];
    if (facts.length > 0) {
      for (const fact of facts.slice(0, 5)) {
        const key = `${fact.subject}|${fact.detail.slice(0, 120)}`;
        if (seenFacts.has(key)) continue;
        seenFacts.add(key);
        lines.push(`• ${fact.subject}: ${fact.detail}`);
      }
      continue;
    }
    const summary = episode.richContent?.summary ?? episode.snippet;
    if (summary) lines.push(`• ${episode.title || episode.domain}: ${summary}`);
  }
  return lines.join("\n\n");
}

function RichBodyEditor(props: {
  html: string;
  onChange: (next: { html: string; text: string }) => void;
  onSelectionChange: (range: Range) => void;
  style: CSSProperties;
}): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    editor.innerHTML = sanitizeBodyHtml(props.html);
  }, [props.html]);

  function emitChange(): void {
    const editor = editorRef.current;
    if (!editor) return;
    props.onChange({
      html: editor.innerHTML,
      text: editor.innerText.replace(/\n+$/, ""),
    });
  }

  function rememberSelection(): void {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      props.onSelectionChange(range.cloneRange());
    }
  }

  return (
    <div
      ref={editorRef}
      className="r-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="일기 본문"
      style={props.style}
      onInput={emitChange}
      onMouseUp={rememberSelection}
      onKeyUp={rememberSelection}
      onBlur={rememberSelection}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand(
          "insertText",
          false,
          event.clipboardData.getData("text/plain"),
        );
      }}
    />
  );
}

function FormatToolbar(props: {
  value: DiaryTextFormat;
  onApplyFontFamily: (fontFamily: DiaryFontFamily) => void;
  onApplyFontSize: (fontSize: number) => void;
  onApplyTextColor: (color: string) => void;
}): JSX.Element {
  return (
    <div className="fmt-toolbar">
      <select
        className="fmt-select"
        defaultValue={props.value.fontFamily}
        onChange={(e) =>
          props.onApplyFontFamily(e.target.value as DiaryFontFamily)
        }
      >
        <option value="system">기본</option>
        <option value="serif">명조</option>
        <option value="gothic">고딕</option>
        <option value="handwriting">손글씨</option>
        <option value="mono">코드체</option>
      </select>

      <select
        className="fmt-select"
        defaultValue={props.value.fontSize}
        onChange={(e) => props.onApplyFontSize(Number(e.target.value))}
      >
        {[12, 13, 14, 15, 16, 17, 18, 20, 22, 24].map((size) => (
          <option key={size} value={size}>
            {size}px
          </option>
        ))}
      </select>

      <div className="fmt-colors">
        {COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            className="fmt-color"
            style={{ background: color }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onApplyTextColor(color)}
            aria-label={`색상 ${color}`}
            title={color}
          />
        ))}
        <label className="fmt-color-custom" title="직접 색상 선택">
          🎨
          <input
            type="color"
            value={props.value.textColor}
            onChange={(e) => props.onApplyTextColor(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function restoreSelection(range: Range | null): Selection | null {
  const selection = window.getSelection();
  if (!selection || !range || range.collapsed) return null;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function applySelectionFormat(
  range: Range | null,
  command: "fontName" | "foreColor",
  value: string,
): void {
  if (!restoreSelection(range)) return;
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(command, false, value);
  notifyEditorChanged();
}

function applySelectionFontSize(range: Range | null, fontSize: number): void {
  if (!restoreSelection(range)) return;
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand("fontSize", false, "7");
  document
    .querySelectorAll<HTMLFontElement>('.r-editor font[size="7"]')
    .forEach((font) => {
      const span = document.createElement("span");
      span.style.fontSize = `${fontSize}px`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
  notifyEditorChanged();
}

function notifyEditorChanged(): void {
  document
    .querySelector(".r-editor")
    ?.dispatchEvent(new Event("input", { bubbles: true }));
}

function sanitizeBodyHtml(html: string): string {
  const documentFragment = new DOMParser().parseFromString(html, "text/html");

  function sanitizeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent ?? "");
    }
    if (!(node instanceof HTMLElement)) return "";

    const children = [...node.childNodes].map(sanitizeNode).join("");
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "<br>";
    if (tag === "span") {
      const styles = [
        isSafeTextColor(node.style.color) &&
          `color: ${escapeHtml(node.style.color)}`,
        isSafeFontFamily(node.style.fontFamily) &&
          `font-family: ${escapeHtml(node.style.fontFamily)}`,
        isSafeFontSize(node.style.fontSize) &&
          `font-size: ${escapeHtml(node.style.fontSize)}`,
      ].filter(Boolean);
      return styles.length > 0
        ? `<span style="${styles.join("; ")}">${children}</span>`
        : children;
    }
    if (tag === "div" || tag === "p") return `${children}<br>`;
    return children;
  }

  return [...documentFragment.body.childNodes]
    .map(sanitizeNode)
    .join("")
    .replace(/(?:<br>)+$/, "");
}

function isSafeFontFamily(fontFamily: string): boolean {
  const normalized = normalizeFontFamily(fontFamily);
  return Object.values(FONT_STYLE_MAP).some(
    (allowed) => normalizeFontFamily(allowed) === normalized,
  ) || Object.values(FONT_COMMAND_MAP).some(
    (allowed) => normalizeFontFamily(allowed) === normalized,
  );
}

function normalizeFontFamily(fontFamily: string): string {
  return fontFamily.replace(/["']/g, "").replace(/\s+/g, " ").toLowerCase();
}

function isSafeFontSize(fontSize: string): boolean {
  const size = Number(fontSize.replace(/px$/i, ""));
  return fontSize.endsWith("px") && size >= 12 && size <= 24;
}

function isSafeTextColor(color: string): boolean {
  return (
    /^#[0-9a-f]{3,8}$/i.test(color) ||
    /^rgba?\([\d\s,.%]+\)$/i.test(color)
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function TagEditor(props: {
  tags: string[];
  onChange: (tags: string[]) => void;
}): JSX.Element {
  const [tagInput, setTagInput] = useState("");

  function addTag(): void {
    const normalized = tagInput.trim().replace(/^#/, "");
    if (!normalized) return;
    if (!props.tags.includes(normalized)) {
      props.onChange([...props.tags, normalized]);
    }
    setTagInput("");
  }

  function removeTag(tag: string): void {
    props.onChange(props.tags.filter((t) => t !== tag));
  }

  return (
    <div className="tag-editor">
      <div className="tag-edit-list">
        {props.tags.map((tag) => (
          <span key={tag} className="tag-edit-chip">
            #{tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label="태그 제거"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          type="text"
          placeholder="태그 추가"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
        />
        <button type="button" onClick={addTag}>
          +
        </button>
      </div>
    </div>
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
          <h1>
            {shortDate(props.day.dateKey)} {dayName(props.day.dateKey)}
          </h1>
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
            <span key={bin.hour}>
              {bin.hour % 3 === 0 ? `${bin.hour}:00` : ""}
            </span>
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
            {shortDate(props.week.startDateKey)} –{" "}
            {shortDate(props.week.endDateKey)}
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
                  {group.label}{" "}
                  {group.count > 1 ? `외 ${group.count - 1}건` : ""}
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

  const topicGroups = groupEpisodesByRelatedTags(props.episodes);

  return (
    <section className="topic-list">
      {topicGroups.map((group) => (
        <section key={group.id} className="dcard episode-card topic-card">
          <header className="topic-head">
            <div>
              <div className="topic-label">{group.label}</div>
              <div className="topic-count">
                {group.episodes.length} related items
              </div>
            </div>
            <div className="pmeta">
              {group.tags.slice(0, 5).map((tag) => (
                <span key={tag} className="pdur">
                  #{tag}
                </span>
              ))}
            </div>
          </header>
          {group.episodes.map((episode) => (
            <article key={episode.id} className="pitem">
          <div className="ptime">{timeLabel(episode.startedAt)}</div>
          <div className="pbody">
            <div className="ptitle">{episode.title || episode.domain}</div>
            <div className="purl">{episode.domain}</div>
            <div className="pmeta">
              <span
                className="ptag"
                style={{
                  background: `${CATEGORY_COLORS[episode.categoryKey]}33`,
                }}
              >
                {episode.isSensitive ? "민감 · 가림" : episode.groupLabel}
              </span>
              {episode.keywords.slice(0, 3).map((keyword) => (
                <span key={keyword} className="pdur">
                  #{keyword}
                </span>
              ))}
            </div>
            <RichContentPreview episode={episode} />
          </div>
        </article>
          ))}
        </section>
      ))}
    </section>
  );
}

function RichContentPreview(props: {
  episode: DiaryEpisode;
}): JSX.Element | null {
  const { episode } = props;
  if (episode.isSensitive) return null;
  const rich = episode.richContent;
  if (!rich && !episode.headings?.length && !episode.snippet) return null;

  return (
    <div className="rich-preview">
      {rich?.video && (
        <div className="rich-video">
          <b>{rich.video.videoTitle}</b>
          {rich.video.channel && <span>{rich.video.channel}</span>}
          {rich.video.description && <p>{rich.video.description}</p>}
        </div>
      )}
      {rich?.conversationTurns?.slice(-3).map((turn, index) => (
        <div key={`${turn.role}-${index}`} className={`rich-turn ${turn.role}`}>
          <b>{turn.role === "user" ? "You" : "AI"}</b>
          <span>{turn.text}</span>
        </div>
      ))}
      {rich?.facts && rich.facts.length > 0 && (
        <div className="rich-facts">
          <div className="rich-facts-title">페이지에서 찾은 구체적 정보</div>
          {rich.facts.slice(0, 8).map((fact, index) => (
            <div key={`${fact.subject}-${index}`} className="rich-fact">
              <b>{fact.subject}</b>
              <span>{fact.detail}</span>
            </div>
          ))}
        </div>
      )}
      {episode.headings && episode.headings.length > 0 && (
        <div className="rich-headings">
          {episode.headings.slice(0, 3).map((heading) => (
            <span key={heading}>{heading}</span>
          ))}
        </div>
      )}
      {rich?.codeBlocks?.slice(0, 1).map((block, index) => (
        <pre key={index} className="rich-code">
          {block.language && <small>{block.language}</small>}
          <code>{block.code}</code>
        </pre>
      ))}
      {!rich?.video && !rich?.conversationTurns?.length && (
        <p className="rich-summary">{rich?.summary ?? episode.snippet}</p>
      )}
      {!rich?.video &&
        !rich?.conversationTurns?.length &&
        rich?.bodyText &&
        rich.bodyText.length > (rich.summary?.length ?? 0) && (
          <details className="rich-body-details">
            <summary>추출된 페이지 본문</summary>
            {rich.sections && rich.sections.length > 0 ? (
              <div className="rich-sections">
                {rich.sections.map((section, index) => (
                  <section key={`${section.heading ?? "section"}-${index}`}>
                    {section.heading && <b>{section.heading}</b>}
                    <p>{section.text}</p>
                  </section>
                ))}
              </div>
            ) : (
              <p className="rich-body-text">{rich.bodyText}</p>
            )}
          </details>
        )}
    </div>
  );
}

type EpisodeTopicGroup = {
  id: string;
  label: string;
  tags: string[];
  episodes: DiaryEpisode[];
};

function groupEpisodesByRelatedTags(
  episodes: DiaryEpisode[],
): EpisodeTopicGroup[] {
  const groups: EpisodeTopicGroup[] = [];
  for (const episode of episodes) {
    const tags = new Set(
      [...episode.keywords, ...episode.tokens].map(normalizeTag),
    );
    const match = groups.find((group) => {
      if (
        episode.groupKey &&
        group.episodes.some((item) => item.groupKey === episode.groupKey)
      )
        return true;
      const shared = group.tags.filter((tag) =>
        [...tags].some((candidate) => areTagsSimilar(tag, candidate)),
      );
      return shared.length >= 2 || (shared.length >= 1 && tags.size <= 3);
    });
    if (match) {
      match.episodes.push(episode);
      match.tags = topEpisodeTags(match.episodes);
      continue;
    }
    groups.push({
      id: episode.groupKey ? `group:${episode.groupKey}` : `episode:${episode.id}`,
      label: episode.groupLabel || episode.keywords[0] || episode.domain,
      tags: topEpisodeTags([episode]),
      episodes: [episode],
    });
  }
  return groups.sort(
    (a, b) =>
      b.episodes.length - a.episodes.length ||
      a.episodes[0].startedAt - b.episodes[0].startedAt,
  );
}

function topEpisodeTags(episodes: DiaryEpisode[]): string[] {
  const counts = new Map<string, number>();
  for (const tag of episodes.flatMap((episode) => episode.keywords)) {
    const normalized = normalizeTag(tag);
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);
}

function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/^#/, "").trim();
}

function areTagsSimilar(left: string, right: string): boolean {
  const a = normalizeTag(left);
  const b = normalizeTag(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
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
