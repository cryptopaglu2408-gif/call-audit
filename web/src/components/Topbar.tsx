import { Bell, Search, Upload } from "lucide-react";

export default function Topbar() {
  return (
    <div className="flex items-center gap-3 mb-5">
      <h1 className="text-xl font-semibold text-slate-900 mr-auto">Call Audit</h1>
      <div className="hidden md:flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5 w-72">
        <Search className="w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search here..."
          className="bg-transparent outline-none text-sm flex-1"
        />
      </div>
      <button className="btn-ghost" title="Upload"><Upload className="w-4 h-4" /></button>
      <button className="relative w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center" title="Notifications">
        <Bell className="w-4 h-4 text-slate-600" />
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rose-500" />
      </button>
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-green to-brand-dark text-white flex items-center justify-center font-semibold">
        S
      </div>
    </div>
  );
}
