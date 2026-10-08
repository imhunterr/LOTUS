import { NavLink, Outlet } from "react-router-dom";
import { deployment } from "../lib/chain";

const NAV = [
  { to: "/", label: "Overview", icon: "◎" },
  { section: "Supply chain" },
  { to: "/manufacturer", label: "Manufacturer", icon: "▣" },
  { to: "/distributor", label: "Distributor", icon: "⇄" },
  { section: "Care" },
  { to: "/prescriber", label: "Prescriber", icon: "✎" },
  { to: "/pharmacy", label: "Pharmacy", icon: "✚" },
  { to: "/patient", label: "Patient app", icon: "♥" },
  { section: "Oversight" },
  { to: "/regulator", label: "Regulator", icon: "⚑" },
  { to: "/verify", label: "Verify a pack", icon: "✓" },
];

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink-700 bg-ink-900 p-5 md:flex">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-lotus-500/15 text-lg text-lotus-400">✿</span>
          <div>
            <p className="font-bold tracking-wide text-white">LOTUS</p>
            <p className="text-[11px] text-slate-500">Lot-level recall, privately</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((n, i) =>
            n.section ? (
              <p key={i} className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{n.section}</p>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    isActive ? "bg-lotus-500/15 text-white" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                  }`
                }
              >
                <span className="w-4 text-center text-lotus-400">{n.icon}</span>
                {n.label}
              </NavLink>
            )
          )}
        </nav>
        <div className="rounded-lg border border-ink-700 p-3 text-[11px] text-slate-500">
          {deployment ? (
            <>Network: <span className="text-slate-300">{deployment.network}</span> · chain {deployment.chainId}</>
          ) : (
            <span className="text-amber-400">Not deployed yet</span>
          )}
        </div>
      </aside>
      <div className="flex-1">
        <nav className="flex gap-2 overflow-x-auto border-b border-ink-700 bg-ink-900 p-3 md:hidden">
          {NAV.filter((n) => n.to).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-slate-300">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="w-full px-4 py-8 md:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
