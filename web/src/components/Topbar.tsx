import { Bell, Search, Upload } from "lucide-react";

export default function Topbar() {
  return (
    <div className="flex items-center gap-4 mb-6">
      <div className="mr-auto">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Call Audit</h1>
        <p className="text-xs text-slate-500 font-medium mt-0.5">Welcome back, Auditor</p>
      </div>
      <div className="hidden md:flex items-center gap-3 bg-white/90 backdrop-blur-sm border border-slate-200/60 rounded-full px-4 py-2 w-80 shadow-sm focus-within:ring-4 focus-within:ring-brand-softGreen/50 focus-within:border-brand-green transition-all duration-300">
        <Search className="w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search for calls, transcripts..."
          className="bg-transparent outline-none text-sm flex-1 text-slate-700 placeholder-slate-400"
        />
      </div>
      <button className="btn-ghost !p-2.5" title="Upload"><Upload className="w-5 h-5" /></button>
      <button className="relative w-11 h-11 rounded-full bg-white border border-slate-200/60 flex items-center justify-center shadow-sm hover:bg-slate-50 transition-colors" title="Notifications">
        <Bell className="w-5 h-5 text-slate-600" />
        <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white" />
      </button>
      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-green to-emerald-600 text-white flex items-center justify-center font-semibold shadow-lg shadow-emerald-200/50 cursor-pointer hover:scale-105 transition-transform duration-300">
        S
      </div>
    </div>
  );
}
