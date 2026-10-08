import { useCallback, useEffect, useState } from "react";
import { errMsg } from "../lib/chain";

export function PageHeader({ eyebrow, title, children }) {
  return (
    <header className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-lotus-400">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">{title}</h1>
      {children && <p className="mt-3 max-w-3xl text-slate-400">{children}</p>}
    </header>
  );
}

export function Card({ title, subtitle, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Stat({ label, value, hint, tone = "default" }) {
  const tones = { default: "text-white", good: "text-emerald-400", warn: "text-amber-400", bad: "text-rose-400" };
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Runs an async action, shows pending / success / revert reason. */
export function TxButton({ onRun, children, className = "btn", disabled }) {
  const [state, setState] = useState({ busy: false, msg: null, ok: null });
  const run = async () => {
    setState({ busy: true, msg: null, ok: null });
    try {
      const msg = await onRun();
      setState({ busy: false, msg: msg || "Done", ok: true });
    } catch (e) {
      setState({ busy: false, msg: errMsg(e), ok: false });
    }
  };
  return (
    <div className="space-y-2">
      <button className={className} disabled={disabled || state.busy} onClick={run}>
        {state.busy ? "Sending…" : children}
      </button>
      {state.msg && <p className={`text-xs ${state.ok ? "text-emerald-400" : "text-rose-400"}`}>{state.msg}</p>}
    </div>
  );
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => setState({ loading: false, data, error: null }),
      (error) => setState({ loading: false, data: null, error })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
      {errMsg(error)}
      <p className="mt-1 text-amber-300/70">Is the local chain running? <code>npm run chain</code> → <code>npm run deploy:local</code> → <code>npm run demo:seed</code></p>
    </div>
  );
}

export const CLASS_LABEL = ["—", "Class I", "Class II", "Class III"];
