import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  GetGroupsResponse,
  GetSettingsResponse,
} from "@/shared/messages";
import type { GroupRecord, Settings } from "@/shared/types";

function Options(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    void load();
  }, []);

  async function load(): Promise<void> {
    const [st, gr] = await Promise.all([
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as Promise<GetSettingsResponse>,
      chrome.runtime.sendMessage({ type: "GET_GROUPS" }) as Promise<GetGroupsResponse>,
    ]);
    setSettings(st?.settings ?? null);
    setGroups(gr?.groups ?? []);
    const drafts: Record<string, string> = {};
    (gr?.groups ?? []).forEach((g) => {
      drafts[g.groupKey] = g.label;
    });
    setLabelDraft(drafts);
  }

  async function update(patch: Partial<Settings>): Promise<void> {
    const res = (await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      settings: patch,
    })) as { ok: boolean; settings: Settings };
    setSettings(res.settings);
  }

  async function saveLabel(groupKey: string): Promise<void> {
    const label = labelDraft[groupKey]?.trim();
    if (!label) return;
    await chrome.runtime.sendMessage({
      type: "UPDATE_GROUP_LABEL",
      groupKey,
      label,
    });
    await load();
  }

  async function resetAll(): Promise<void> {
    if (!confirm("모든 그룹 데이터를 삭제합니다. 계속할까요?")) return;
    await chrome.runtime.sendMessage({ type: "RESET_ALL" });
    await load();
  }

  if (!settings) return <div className="page">불러오는 중…</div>;

  return (
    <div className="page">
      <h1>Auto Tab Group 설정</h1>

      <div className="card">
        <h2>분류 동작</h2>
        <div className="row">
          <label htmlFor="enabled">자동 분류 활성화</label>
          <input
            id="enabled"
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
        </div>
        <div className="row">
          <label htmlFor="threshold">
            그룹 합류 임계값 (코사인 유사도)
          </label>
          <input
            id="threshold"
            type="range"
            min={0.5}
            max={0.9}
            step={0.01}
            value={settings.threshold}
            onChange={(e) => update({ threshold: Number(e.target.value) })}
          />
          <span className="value">{settings.threshold.toFixed(2)}</span>
        </div>
        <div className="row">
          <label htmlFor="content">페이지 본문 추출 사용</label>
          <input
            id="content"
            type="checkbox"
            checked={settings.contentExtractionEnabled}
            onChange={(e) =>
              update({ contentExtractionEnabled: e.target.checked })
            }
          />
        </div>
        <div className="row">
          <label htmlFor="groupMerge">유사 그룹 자동 병합</label>
          <input
            id="groupMerge"
            type="checkbox"
            checked={settings.groupMergeEnabled}
            onChange={(e) => update({ groupMergeEnabled: e.target.checked })}
          />
        </div>
        <div className="row">
          <label htmlFor="maxdocs">그룹당 최대 문서 수</label>
          <input
            id="maxdocs"
            type="number"
            min={5}
            max={500}
            step={1}
            value={settings.maxDocsPerGroup}
            onChange={(e) =>
              update({ maxDocsPerGroup: Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="card">
        <h2>그룹 라벨</h2>
        {groups.length === 0 ? (
          <div className="row">
            <label>아직 그룹이 없습니다.</label>
          </div>
        ) : (
          groups.map((g) => (
            <div className="group-row" key={g.groupKey}>
              <span className={`color-dot color-${g.color}`} />
              <input
                type="text"
                value={labelDraft[g.groupKey] ?? ""}
                onChange={(e) =>
                  setLabelDraft({ ...labelDraft, [g.groupKey]: e.target.value })
                }
              />
              <span className="doc-count">{g.docCount}</span>
              <button
                className="save"
                onClick={() => saveLabel(g.groupKey)}
                disabled={labelDraft[g.groupKey] === g.label}
              >
                저장
              </button>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>위험 영역</h2>
        <div className="row">
          <label>모든 그룹 데이터를 삭제합니다.</label>
          <button className="danger" onClick={resetAll}>
            전체 초기화
          </button>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<Options />);
}
