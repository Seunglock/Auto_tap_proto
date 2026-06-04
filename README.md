# Auto Tab Group (BerTopic-inspired)

Chrome 확장(Manifest V3)으로, 새 탭이 열릴 때마다 의미적으로 유사한 기존 그룹에 자동 분류하거나 새 그룹을 생성합니다. 모든 임베딩과 클러스터링은 브라우저 안에서 실행되어, 탭 콘텐츠가 외부 서버로 나가지 않습니다.

## 핵심 아이디어

[BerTopic](https://maartengr.github.io/BERTopic/)의 4단계 파이프라인(임베딩 → 차원축소 → 클러스터링 → c-TF-IDF)을 Transformers.js 기반의 온라인 증분 알고리즘으로 단순화·이식했습니다.

| BerTopic 단계 | 본 확장 구현 |
|---|---|
| Sentence-BERT 임베딩 | Transformers.js + `Xenova/multilingual-e5-small` (한국어 포함 100개 언어) |
| UMAP 차원축소 | 생략 — 384차원에서 직접 코사인 유사도 |
| HDBSCAN | 온라인 증분: 새 임베딩 vs. 기존 그룹 centroid 코사인 유사도 ≥ 임계값(기본 0.75)이면 합류, 아니면 새 그룹 |
| c-TF-IDF | 그룹 단위 토큰화 + TF × log((G+1)/(df+1))로 상위 1~2 키워드를 라벨로 사용 |

## 동작 흐름

1. `chrome.tabs.onUpdated` (status `complete`) → 300ms 디바운스 후 분류 시작
2. 콘텐츠 스크립트에서 사이트별 추출기로 (제목, URL, 본문 일부) 수집
   - `claude.ai`, `chatgpt.com`, `gemini.google.com`은 대화 메시지를 직접 추출
   - 그 외는 `meta description` + `h1` + 본문 앞 500자
3. `passage: {title} | {domain} | {snippet}` 형식으로 임베딩 (e5 프리픽스)
4. 모든 그룹의 centroid와 코사인 유사도 비교 → 임계값 충족 시 합류, 아니면 새 그룹
5. centroid를 incremental running mean으로 업데이트 후 L2 정규화
6. 그룹 라벨을 c-TF-IDF로 재계산하여 `chrome.tabGroups.update`

### 동적 SPA(채팅 앱) 재분류

콘텐츠 스크립트는 페이지에 상주하면서 `MutationObserver`로 본문 변화를 감시합니다. 5초 디바운스 + 누적 변경량이 200자 이상이면 백그라운드에 `RECLASSIFY` 메시지를 보내고:

- 기본적으로 사용자가 이미 그룹에 속한 탭은 건드리지 않습니다.
- 단, 첫 분류 시점에 콘텐츠가 짧았던 탭(`pendingReclassify=true`)은 한 번 더 분류 가능 — 빈 새 채팅 탭이 대화가 쌓인 후 적절한 그룹으로 합류할 수 있도록 합니다.
- 그 외의 경우엔 centroid 갱신은 발생하지 않고 그룹 이동도 없습니다.

## 제외 대상

- 이미 다른 그룹에 속한 탭
- pinned 탭
- `chrome://`, `chrome-extension://`, `about:`, `view-source:`, `file://`, `devtools://` 등 내부 URL
- `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`
- 시크릿 창 탭

## 빌드 및 실행

```bash
npm install
npm run build
```

빌드 결과는 `dist/`에 생성됩니다. Chrome에서:

1. `chrome://extensions/` 접속
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → `dist/` 선택

서비스 워커 콘솔: `chrome://extensions/`의 "Service Worker" 링크.

## 옵션

- **자동 분류 활성화** — 마스터 ON/OFF
- **그룹 합류 임계값** (0.5~0.9, 기본 0.75) — 낮으면 더 많이 묶이고, 높으면 더 세분화
- **페이지 본문 추출** — 끄면 제목 + 도메인만 사용
- **그룹당 최대 문서 수** — c-TF-IDF의 메모리 보호 (기본 50)
- **그룹 라벨 직접 수정**
- **전체 초기화**

## 알려진 제약 / v2 후보

- 모델 가중치(약 118MB)는 첫 사용 시 CDN에서 다운로드되어 브라우저 캐시(Cache API)에 저장됩니다. 두 번째 사용부터는 즉시 응답.
- HDBSCAN/UMAP을 추가한 배치 재클러스터링은 미구현 (탭이 수백 개에 달하는 경우에 가치).
- 사이트별 콘텐츠 수집 화이트리스트/블랙리스트 UI는 미구현 (옵션 페이지에서 본문 추출을 일괄 끌 수만 있음).
- 그룹이 너무 많아질 때의 자동 병합은 미구현.

## 디렉토리 구조

```
src/
├── background/      # 서비스 워커: 임베딩, 분류, 클러스터링, 라벨링, storage
├── content/         # 페이지 상주 콘텐츠 스크립트 + 사이트별 추출기
├── popup/           # 그룹 목록 + 토글 + 수동 정리 버튼
├── options/         # 임계값, 라벨 수정, 전체 초기화
└── shared/          # 타입, 상수, 메시지 정의

## 논문 링크

https://ieeexplore.ieee.org/document/7498440
https://ieeexplore.ieee.org/document/5197084
https://ieeexplore.ieee.org/document/5190800
```
