// Settings → AI Apps: island style for AI tasks, the local API, Claude Code
// hooks, detected apps and history.
import { useEffect, useMemo, useState } from "react";
import { LazyMotion, domAnimation } from "framer-motion";
import type { AiConfig } from "../lib/config";
import { AI_STYLES, apiInfo, clearHistory, demo, detectApps, getHistory, type AiStatus, type AiTask, type ApiInfo, type HistoryItem } from "../lib/ai";
import { aiLook } from "../island/ai/AiViews";
import { Row, Segmented, Toggle } from "./controls";
import type { SectionProps } from "./sections";

const SAMPLE: AiTask = {
  id: "preview", app: "Claude", tag: "PC Customizer", title: "Move 12 files to Archive?", detail: "", status: "permission",
  step: 2, steps: 3, stepLabels: ["Scan", "Sort", "Archive"], result: null, decision: null, updated: 0,
};
const P = 0.44;
const PREVIEW_TITLES: Record<AiStatus, string> = {
  running: "Organizing files",
  permission: "Move 12 files to Archive?",
  completed: "12 files organized",
  attention: "Archive unavailable",
};

export function AiSection({ config, update }: SectionProps) {
  const c = config.ai;
  const set = (patch: Partial<AiConfig>, immediate = true) => update((x) => ({ ...x, ai: { ...x.ai, ...patch } }), { immediate });
  const [state, setState] = useState<AiStatus>("permission");
  const [info, setInfo] = useState<ApiInfo | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    getHistory().then(setHistory).catch(() => {});
    const t = window.setTimeout(() => apiInfo().then(setInfo).catch(() => {}), 300);
    return () => window.clearTimeout(t);
  }, [c.apiEnabled, c.apiPort]);

  const sample = useMemo(() => ({ ...SAMPLE, status: state, title: PREVIEW_TITLES[state], step: state === "running" ? 1 : SAMPLE.step }), [state]);
  const base = `http://127.0.0.1:${c.apiPort}`;
  const curl = `curl -X POST ${base}/v1/notify -H "X-DeskFlow-Token: ${c.apiToken}" -H "Content-Type: application/json" -d "{\\"app\\":\\"Claude\\",\\"title\\":\\"Hello\\",\\"body\\":\\"From the API\\"}"`;
  const hookCmd = `curl -s -m 58 -X POST -H "X-DeskFlow-Token: ${c.apiToken}" --data-binary @- ${base}/v1/hooks/claude-code || true`;
  const hook = (timeout?: number, matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCmd, ...(timeout ? { timeout } : {}) }] }];
  const hooksJson = JSON.stringify(
    {
      hooks: {
        UserPromptSubmit: hook(),
        PreToolUse: hook(5, "*"),
        PermissionRequest: hook(60, "*"),
        Notification: hook(),
        Stop: hook(),
        SessionEnd: hook(),
      },
    },
    null,
    2,
  );
  const copy = (what: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <LazyMotion features={domAnimation}>
      <div className="space-y-2.5">
        <Row label="Try it" description="Plays a sample task on the island: running, then a permission request, then the result.">
          <button type="button" onClick={() => demo()} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
            Preview on island
          </button>
        </Row>

        <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">Island style for AI tasks</h2>
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[12px] text-muted">Show the previews as:</span>
          <Segmented label="Preview state" value={state} onChange={setState}
            options={[
              { value: "running", label: "Running" },
              { value: "permission", label: "Permission" },
              { value: "completed", label: "Completed" },
              { value: "attention", label: "Attention" },
            ]} />
        </div>
        <div role="radiogroup" aria-label="AI island style" className="grid grid-cols-2 gap-2.5">
          {AI_STYLES.map((st) => {
            const look = aiLook(st.id, sample, c.apps, P);
            const on = c.style === st.id;
            return (
              <button key={st.id} type="button" role="radio" aria-checked={on} onClick={() => set({ style: st.id })}
                className={`flex flex-col items-center gap-2 overflow-hidden rounded-xl border p-3 text-left transition-colors ${on ? "border-accent bg-accent/10" : "border-line hover:bg-panel-hover"}`}>
                <div className="pointer-events-none flex h-[112px] w-full items-center justify-center rounded-lg bg-[radial-gradient(circle_at_50%_0%,#3b4252,#16181d)]">
                  <div className="relative flex items-center"
                    style={{
                      width: look.w * P, height: look.h * P, borderRadius: look.r * P,
                      ...(look.bare ? {} : look.surface), boxShadow: look.bare ? undefined : look.shadow,
                      padding: look.bare ? 0 : "0 9px", overflow: look.bare ? "visible" : "hidden", fontSize: 6.5,
                    }}>
                    {look.content}
                  </div>
                </div>
                <span className="w-full">
                  <span className="block text-[13px] font-medium">{st.label}</span>
                  <span className="block text-[11.5px] text-muted">{st.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">Notifications</h2>
        <Row label="Do not disturb" description="Keep AI notifications out of the island. Permission requests still show, and everything goes into History." htmlFor="ai-dnd">
          <Toggle id="ai-dnd" label="Do not disturb" checked={c.dnd} onChange={(v) => set({ dnd: v })} />
        </Row>
        <Row label="Sound" description="A soft chime when an AI notification arrives." htmlFor="ai-sound">
          <Toggle id="ai-sound" label="Sound" checked={c.sound} onChange={(v) => set({ sound: v })} />
        </Row>
        <Row label="AI section in the dock" description="Group your AI apps at the start of the dock with a glowing ring; it pulses while a task runs." htmlFor="ai-dock">
          <Toggle id="ai-dock" label="AI section in the dock" checked={c.dockSection} onChange={(v) => set({ dockSection: v })} />
        </Row>

        <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">AI apps on this PC</h2>
        <Row label={c.apps.length ? c.apps.map((a) => a.name).join(", ") : "None found yet"} description="Found from your Start menu. These get the AI section in the dock and their icons on AI cards.">
          <button type="button" disabled={scanning}
            onClick={async () => {
              setScanning(true);
              const apps = await detectApps().catch(() => c.apps);
              set({ apps });
              setScanning(false);
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-panel-hover disabled:opacity-50">
            {scanning ? "Scanning…" : "Scan again"}
          </button>
        </Row>

        <h2 className="pt-3 pb-1 text-[13px] font-semibold text-muted">Connect apps</h2>
        <Row label="Local API" description={info ? (info.running ? `Listening on ${base} (this PC only)` : c.apiEnabled ? `Couldn't start on port ${c.apiPort}; it may be in use` : "Off") : "…"} htmlFor="ai-api">
          <Toggle id="ai-api" label="Local API" checked={c.apiEnabled} onChange={(v) => set({ apiEnabled: v })} />
        </Row>
        <Row label="Port" htmlFor="ai-port">
          <input id="ai-port" type="number" min={1024} max={65535} value={c.apiPort}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1024 && n <= 65535) set({ apiPort: n }, false);
            }}
            className="w-24 rounded-lg border border-line bg-transparent px-2 py-1 text-[13px]" />
        </Row>
        <Row label="Token" description="Apps send this in an X-DeskFlow-Token header. Keep it private.">
          <div className="flex items-center gap-2">
            <code className="rounded bg-panel-hover px-2 py-1 text-[12px]">{c.apiToken.slice(0, 6)}…{c.apiToken.slice(-4)}</code>
            <button type="button" onClick={() => copy("token", c.apiToken)} className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] hover:bg-panel-hover">
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>
        </Row>

        <div className="rounded-xl border border-line p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-medium">Claude Code</p>
              <p className="text-[12px] text-muted">
                Shows Claude Code's work on the island, and lets you Allow or Deny its permission requests from there. Merge this into
                <code className="mx-1">%USERPROFILE%\.claude\settings.json</code>.
              </p>
            </div>
            <button type="button" onClick={() => copy("hooks", hooksJson)} className="ml-3 shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90">
              {copied === "hooks" ? "Copied" : "Copy hooks"}
            </button>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-2.5 text-[11px] leading-snug">{hooksJson}</pre>
        </div>

        <div className="rounded-xl border border-line p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13.5px] font-medium">Any app or script</p>
              <p className="text-[12px] text-muted">POST /v1/notify for a card, /v1/tasks for a live task. Example:</p>
            </div>
            <button type="button" onClick={() => copy("curl", curl)} className="ml-3 shrink-0 rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-panel-hover">
              {copied === "curl" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="mt-2 overflow-auto rounded-lg bg-black/30 p-2.5 text-[11px] leading-snug whitespace-pre-wrap break-all">{curl}</pre>
        </div>

        <div className="flex items-center justify-between pt-3 pb-1">
          <h2 className="text-[13px] font-semibold text-muted">History</h2>
          {history.length > 0 && (
            <button type="button" onClick={() => clearHistory().then(() => setHistory([]))} className="text-[12px] text-muted hover:text-current">
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="px-1 text-[12.5px] text-muted">Nothing yet. Notifications and finished tasks will be listed here.</p>
        ) : (
          history.slice(0, 30).map((h) => (
            <Row key={`${h.type}:${h.id}`}
              label={`${h.app} · ${h.title}`}
              description={h.type === "notification" ? h.body : h.detail || ({ running: "Running", permission: "Asked for permission", completed: "Completed", attention: "Needed attention" } as const)[h.status]}>
              <span className="text-[12px] text-muted">{new Date(h.type === "notification" ? h.at : h.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </Row>
          ))
        )}
      </div>
    </LazyMotion>
  );
}
