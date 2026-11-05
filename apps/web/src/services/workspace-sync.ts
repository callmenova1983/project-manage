import {
  syncDomains,
  type SyncDomain,
  type SyncVersions,
} from "../../../../packages/domain/workspace-sync";

/** One calibration in flight, with a trailing pass if hints arrive during a read. */
export function createWorkspaceSync(options: {
  local: boolean;
  meta: () => Promise<SyncVersions>;
  applied: () => SyncVersions;
  apply: (domain: SyncDomain, version: string) => Promise<void>;
  failure: (error: unknown) => void;
}) {
  let stopped = true,
    source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined,
    debounce: ReturnType<typeof setTimeout> | undefined;
  let running = false,
    dirty = false,
    failures = 0,
    epoch = 0;
  function schedule(delay: number) {
    if (timer) clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void calibrate(), delay);
  }
  async function calibrate() {
    if (stopped || document.hidden) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    const generation = epoch;
    try {
      do {
        dirty = false;
        const versions = await options.meta();
        if (stopped || generation !== epoch) return;
        await Promise.all(
          syncDomains
            .filter((domain) => options.applied()[domain] !== versions[domain])
            .map((domain) => options.apply(domain, versions[domain])),
        );
      } while (dirty && !stopped && generation === epoch);
      failures = 0;
    } catch (error) {
      if (generation === epoch) {
        failures++;
        options.failure(error);
      }
    } finally {
      running = false;
      if (!stopped && generation !== epoch) schedule(0);
      else if (!stopped)
        schedule(
          failures
            ? Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4))
            : options.local || source?.readyState === EventSource.OPEN
              ? 60000
              : 2000,
        );
    }
  }
  function hint() {
    if (stopped) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void calibrate();
    }, 150);
  }
  function start() {
    if (!stopped || document.hidden) return;
    stopped = false;
    epoch++;
    if (
      !options.local &&
      import.meta.env.VITE_WORKSPACE_SSE !== "0" &&
      typeof EventSource !== "undefined"
    ) {
      source = new EventSource("/api/workspace/events");
      source.onopen = () => void calibrate();
      source.onmessage = hint;
      source.onerror = () => schedule(2000);
    }
    window.addEventListener("storage", hint);
    window.addEventListener("pm:local-workspace-changed", hint);
    void calibrate();
  }
  function stop() {
    stopped = true;
    epoch++;
    dirty = false;
    source?.close();
    source = undefined;
    if (timer) clearTimeout(timer);
    if (debounce) clearTimeout(debounce);
    window.removeEventListener("storage", hint);
    window.removeEventListener("pm:local-workspace-changed", hint);
  }
  return { start, stop, calibrate, hint };
}
