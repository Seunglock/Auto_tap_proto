import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  GetGroupsResponse,
  GetSettingsResponse,
  GetSummaryResponse,
} from "@/shared/messages";
import type { CollectionSummary, GroupRecord, Settings } from "@/shared/types";

function relativeTime(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return "방금 전";
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

function Popup(): JSX.Element {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll(): Promise<void> {
    const [gr, st, su] = await Promise.all([
      chrome.runtime.sendMessage({
        type: "GET_GROUPS",
      }) as Promise<GetGroupsResponse>,
      chrome.runtime.sendMessage({
        type: "GET_SETTINGS",
      }) as Promise<GetSettingsResponse>,
      chrome.runtime.sendMessage({
        type: "GET_SUMMARY",
      }) as Promise<GetSummaryResponse>,
    ]);
    setGroups(gr?.groups ?? []);
    setSettings(st?.settings ?? null);
    setSummary(su?.summary ?? null);
  }

  async function toggleEnabled(enabled: boolean): Promise<void> {
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      settings: { enabled },
    });
    setSettings((prev) => (prev ? { ...prev, enabled } : prev));
  }

  async function regroupAll(): Promise<void> {
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: "REGROUP_ALL" });
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  function openOptions(): void {
    chrome.runtime.openOptionsPage();
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Auto Tab Group</h1>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings?.enabled ?? true}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          자동 분류
        </label>
      </div>

      {/* Summary card */}
      {summary && summary.totalGroups > 0 && (
        <div className="summary-card">
          <div className="summary-stats">
            <span className="summary-count">
              탭 <strong>{summary.totalDocuments}</strong>개 · 그룹{" "}
              <strong>{summary.totalGroups}</strong>개
            </span>
            {summary.lastUpdatedAt && (
              <span className="summary-time">
                {relativeTime(summary.lastUpdatedAt)}
              </span>
            )}
          </div>
          {summary.topKeywords.length > 0 && (
            <div className="summary-keywords">
              {summary.topKeywords.slice(0, 6).map((kw) => (
                <span key={kw} className="keyword-tag">
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="actions">
        <button
          className="primary"
          onClick={regroupAll}
          disabled={busy || !settings?.enabled}
        >
          {busy ? "정리 중..." : "지금 미분류 탭 정리"}
        </button>
      </div>

      <div className="section-title">현재 그룹 ({groups.length})</div>
      {groups.length === 0 ? (
        <div className="empty">아직 자동 그룹이 없습니다.</div>
      ) : (
        <ul className="group-list">
          {groups.map((g) => {
            const gs = summary?.groups.find((s) => s.groupKey === g.groupKey);
            return (
              <li key={g.groupKey} className="group-item">
                <span className={`color-dot color-${g.color}`} />
                <div className="group-body">
                  <div className="group-header-row">
                    <span className="group-label" title={g.label}>
                      {g.label}
                    </span>
                    <span className="group-count">{g.docCount}</span>
                  </div>
                  {gs && gs.topKeywords.length > 0 && (
                    <div className="group-keywords">
                      {gs.topKeywords.slice(0, 3).join(" · ")}
                    </div>
                  )}
                  {gs && gs.topDomains.length > 0 && (
                    <div className="group-domains">
                      {gs.topDomains.slice(0, 2).join(", ")}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="footer">
        <a onClick={openOptions}>설정 →</a>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Popup />);
}
