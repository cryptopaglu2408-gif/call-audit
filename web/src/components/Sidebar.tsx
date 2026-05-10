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
    <aside className="bg-brand-dark text-white w-20 flex flex-col items-center py-5 gap-3 sticky top-0 h-screen">
      <div className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center mb-3">
        <Phone className="w-5 h-5" />
      </div>
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
    </aside>
  );
}
