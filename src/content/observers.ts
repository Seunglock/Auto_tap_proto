type Listener = () => void;

const RECLASSIFY_DEBOUNCE_MS = 5000;
const MIN_DELTA_CHARS = 200;

export class ContentChangeWatcher {
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSignalLength = 0;
  private accumulatedDelta = 0;
  private listener: Listener;

  constructor(listener: Listener) {
    this.listener = listener;
  }

  start(initialLength: number): void {
    this.lastSignalLength = initialLength;
    this.observer = new MutationObserver(() => this.onMutation());
    if (document.body) {
      this.observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
    this.patchHistory();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer) clearTimeout(this.timer);
  }

  noteSignaled(currentLength: number): void {
    this.lastSignalLength = currentLength;
    this.accumulatedDelta = 0;
  }

  private onMutation(): void {
    const currentLength = (document.body?.innerText?.length ?? 0);
    const delta = Math.abs(currentLength - this.lastSignalLength);
    this.accumulatedDelta = Math.max(this.accumulatedDelta, delta);
    if (this.accumulatedDelta < MIN_DELTA_CHARS) return;
    this.scheduleSignal();
  }

  private scheduleSignal(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.listener();
    }, RECLASSIFY_DEBOUNCE_MS);
  }

  private patchHistory(): void {
    const fire = () => this.scheduleSignal();
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      origPush(...args);
      fire();
    };
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      fire();
    };
    window.addEventListener("popstate", fire);
  }
}
