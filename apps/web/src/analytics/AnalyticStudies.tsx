import { Link } from "wouter";
import { FlaskConical } from "lucide-react";
import { allStudies } from "@/studies/registry";

export function AnalyticStudies({ category }: { category: "Descriptive" | "Diagnostic" | "Predictive" | "Prescriptive" }) {
  const studies = allStudies().filter(s => s.category === category);
  
  if (studies.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-neutral-800">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="h-4 w-4 text-[#E69F00]" />
        <h3 className="text-sm font-semibold text-neutral-200 uppercase tracking-wider">{category} Studies & Research</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {studies.map((study) => (
          <Link
            key={study.slug}
            href={`/studies/${study.slug}`}
            className="flex flex-col rounded-md border border-neutral-800 bg-neutral-900/30 p-3 hover:bg-neutral-800/60 transition-colors group"
          >
            <div className="flex items-center justify-between gap-4">
              <h4 className="font-medium text-neutral-200 group-hover:text-blue-400 transition-colors line-clamp-1">{study.title}</h4>
              <span className="text-[10px] text-neutral-500 bg-neutral-800 px-1.5 py-0.5 rounded uppercase shrink-0">{study.status}</span>
            </div>
            <p className="mt-1.5 text-xs text-neutral-400 line-clamp-2 leading-relaxed">{study.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
