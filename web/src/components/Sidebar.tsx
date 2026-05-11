import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Headphones, ClipboardList, BarChart3, Phone,
} from "lucide-react";

const items = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/process",   icon: Headphones,      label: "Process calls" },
  { to: "/rubric",    icon: ClipboardList,   label: "Rubric" },
  { to: "/results",   icon: BarChart3,       label: "Results" },
];

export default function Sidebar() {
  return (
    <aside className="bg-gradient-to-b from-brand-dark to-[#0a2c22] text-white w-20 flex flex-col items-center py-6 gap-4 sticky top-0 h-screen border-r border-white/5">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-green to-emerald-600 flex items-center justify-center mb-6 shadow-lg shadow-emerald-900/50 transform hover:rotate-12 transition-transform duration-300 cursor-pointer">
        <Phone className="w-6 h-6 text-white" />
      </div>
      <div className="flex-1 flex flex-col items-center gap-4 w-full">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <Icon className="w-5 h-5" />
          </NavLink>
        ))}
      </div>
      <div className="mt-auto mb-2">
        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer" title="Version">
          <span className="text-xs font-semibold text-white/50">v1.0</span>
        </div>
      </div>
    </aside>
  );
}
