import { ArrowUpRight, type LucideIcon } from "lucide-react";

type Tone = "lavender" | "blue" | "pink" | "peach";

const toneClass: Record<Tone, string> = {
  lavender: "bg-gradient-to-br from-violet-50 to-indigo-100 border-violet-200/50",
  blue: "bg-gradient-to-br from-blue-50 to-cyan-100 border-blue-200/50",
  pink: "bg-gradient-to-br from-pink-50 to-rose-100 border-pink-200/50",
  peach: "bg-gradient-to-br from-orange-50 to-amber-100 border-orange-200/50",
};

interface Props {
  label: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
  icon: LucideIcon;
  tone?: Tone;
}

export default function KpiCard({
  label, value, delta, deltaUp = true, icon: Icon, tone = "lavender",
}: Props) {
  return (
    <div className={`relative rounded-2xl border shadow-lg shadow-slate-200/50 p-6 min-h-[140px] transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${toneClass[tone]}`}>
      <div className="w-12 h-12 rounded-xl bg-white/80 backdrop-blur-sm flex items-center justify-center shadow-sm">
        <Icon className="w-6 h-6 text-slate-700" />
      </div>
      <div className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gradient-to-r from-brand-green to-emerald-600 flex items-center justify-center shadow-md">
        <ArrowUpRight className="w-4 h-4 text-white" />
      </div>
      <div className="mt-5 text-xs text-slate-600 font-semibold uppercase tracking-wide">{label}</div>
      <div className="flex items-baseline justify-between mt-2">
        <div className="text-3xl font-bold text-slate-900 tracking-tight">{value}</div>
        {delta && (
          <span className={deltaUp ? "delta-up" : "delta-down"}>
            {deltaUp ? "+" : "-"}{delta}
          </span>
        )}
      </div>
    </div>
  );
}
