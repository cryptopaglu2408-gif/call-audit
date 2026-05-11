import { NavLink } from 'react-router-dom'
import { LayoutDashboard, BarChart3, SlidersHorizontal, Workflow, Users } from 'lucide-react'

const links = [
  { to: '/',         label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/results',  label: 'Results',   Icon: BarChart3 },
  { to: '/agents',   label: 'Agents',    Icon: Users },
  { to: '/rubric',   label: 'Rubric',    Icon: SlidersHorizontal },
  { to: '/pipeline', label: 'Pipeline',  Icon: Workflow },
]

export default function Sidebar() {
  return (
    <aside className="w-[72px] hover:w-[240px] bg-gradient-to-b from-[#0d1117] to-[#05070a] flex flex-col shrink-0 border-r border-white/5 transition-all duration-300 ease-in-out group z-20">
      {/* Brand */}
      <div className="px-4 pt-7 pb-6 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-900/30 transform hover:rotate-12 transition-transform duration-300">
            <span className="text-white text-xs font-bold">CA</span>
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap flex flex-col justify-center">
            <p className="text-white font-bold text-sm tracking-tight">Call Audit</p>
            <p className="text-white/30 text-[10px] mt-0.5 font-medium">SuperSheldon</p>
          </div>
        </div>
      </div>

      <div className="mx-4 h-px bg-white/5 mb-4" />

      {/* Nav */}
      <nav className="flex-1 px-4 space-y-2 overflow-hidden">
        <p className="text-white/20 text-[10px] font-bold uppercase tracking-widest px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">Menu</p>
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 h-10 rounded-xl text-[13px] font-semibold transition-all duration-300 overflow-hidden ${
                isActive
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/5'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="w-10 h-10 flex items-center justify-center shrink-0">
                  <Icon size={18} className={isActive ? 'text-green-400' : 'text-white/40'} />
                </div>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
                  {label}
                </span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400 shadow-lg shadow-green-400/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mr-4" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
