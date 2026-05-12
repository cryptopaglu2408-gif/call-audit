import { NavLink } from 'react-router-dom'
import { LayoutDashboard, BarChart3, SlidersHorizontal, Workflow, Users, LogOut, MessageSquare } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const links = [
  { to: '/',         label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/results',  label: 'Results',   Icon: BarChart3 },
  { to: '/agents',   label: 'Agents',    Icon: Users },
  { to: '/rubric',   label: 'Rubric',    Icon: SlidersHorizontal },
  { to: '/pipeline', label: 'Pipeline',  Icon: Workflow },
  { to: '/slack',    label: 'Slack',     Icon: MessageSquare },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const initials = user?.email?.split('@')[0]?.slice(0, 2).toUpperCase() ?? '?'
  const username = user?.email?.split('@')[0] ?? ''

  return (
    <aside className="w-[80px] hover:w-[240px] bg-gradient-to-b from-[#0d1117] to-[#05070a] flex flex-col shrink-0 border-r border-white/5 transition-[width] duration-300 ease-in-out group z-20 [will-change:width]">
      {/* Brand */}
      <div className="px-4 pt-7 pb-6 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0 transform hover:rotate-12 transition-transform duration-300">
            <img src="/logo.png" alt="Call Audit Logo" className="w-full h-full object-contain" />
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap flex flex-col justify-center">
            <p className="text-white font-bold text-sm tracking-tight">Call Audit</p>
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

      {/* User + logout */}
      <div className="px-4 py-5 border-t border-white/5">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 border border-white/10">
            <span className="text-white/70 text-xs font-bold">{initials}</span>
          </div>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex-1 min-w-0">
            <p className="text-white/70 text-xs font-semibold truncate">{username}</p>
            <p className="text-white/25 text-[10px] font-medium">supersheldon.com</p>
          </div>
          <button
            onClick={signOut}
            title="Sign out"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-1.5 text-white/30 hover:text-rose-400 hover:bg-white/5 rounded-lg transition-colors shrink-0"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  )
}
