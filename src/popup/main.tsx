import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  GetGroupsResponse,
  GetSettingsResponse,
} from "@/shared/messages";
import type { GroupRecord, Settings } from "@/shared/types";

function Popup(): JSX.Element {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll(): Promise<void> {
    const [gr, st] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_GROUPS" }) as Promise<GetGroupsResponse>,
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as Promise<GetSettingsResponse>,
    ]);
    setGroups(gr?.groups ?? []);
    setSettings(st?.settings ?? null);
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
          {groups.map((g) => (
            <li key={g.groupKey} className="group-item">
              <span className={`color-dot color-${g.color}`} />
              <span className="group-label" title={g.label}>
                {g.label}
              </span>
              <span className="group-count">{g.docCount}</span>
            </li>
          ))}
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
