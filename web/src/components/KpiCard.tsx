import { ArrowUpRight, type LucideIcon } from "lucide-react";

type Tone = "lavender" | "blue" | "pink" | "peach";

const toneClass: Record<Tone, string> = {
  lavender: "bg-kpi-lavender",
  blue: "bg-kpi-blue",
  pink: "bg-kpi-pink",
  peach: "bg-kpi-peach",
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
    <div className={`relative rounded-2xl shadow-card p-5 min-h-[140px] ${toneClass[tone]}`}>
      <div className="w-10 h-10 rounded-full bg-white/70 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-700" />
      </div>
      <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-brand-green flex items-center justify-center">
        <ArrowUpRight className="w-4 h-4 text-white" />
      </div>
      <div className="mt-4 text-sm text-slate-600 font-medium">{label}</div>
      <div className="flex items-baseline justify-between mt-1">
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        {delta && (
          <span className={deltaUp ? "delta-up" : "delta-down"}>
            {deltaUp ? "+" : "-"}{delta}
          </span>
        )}
      </div>
    </div>
  );
}
