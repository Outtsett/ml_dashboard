/**
 * `/studies/:slug`: the study's header (title, question, what it replaced,
 * related pages) and its page, loaded as its own chunk.
 */

import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { ErrorBoundary } from "@/shared/layout/ErrorBoundary";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { requestSidePanelWidth } from "@/shared/layout/ResizableSidePanel";
import { studyEntry } from "./registry";
import { useEntityStore } from "@/shared/contexts/EntityContext";

const pages = new Map<string, ComponentType>();

function pageFor(slug: string): ComponentType | null {
  const entry = studyEntry(slug);
  if (!entry) return null;
  let page = pages.get(slug);
  if (!page) {
    page = lazy(entry.load);
    pages.set(slug, page);
  }
  return page;
}

const STATUS_LABEL: Record<string, string> = {
  "active-research": "active research",
  "record-of-past-round": "record of a finished round",
  "diagnostic-tool": "diagnostic",
};

export default function StudyPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const entry = studyEntry(slug);
  const Page = pageFor(slug);

  // A study is charts side by side: open the panel wide (the reader can still drag it back).
  useEffect(() => {
    requestSidePanelWidth("wide");
  }, [slug]);

  if (!entry || !Page) {
    return (
      <div className="p-4 text-sm text-neutral-300">
        No study named <span className="font-mono">{slug}</span>.{" "}
        <Link href="/analytics" className="text-[#56B4E9] underline">Back to Analytics</Link>
      </div>
    );
  }
  const { meta } = entry;
  const { setEntity, activeEntity } = useEntityStore();
  const isActive = activeEntity?.type === 'study' && activeEntity?.id === slug;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3 relative">
        <Link href="/analytics" className="mb-1 inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300">
          <ArrowLeft className="h-3 w-3" /> Analytics · {meta.category}
        </Link>
        <div className="absolute right-4 top-4">
          <button 
            className={`text-xs px-3 py-1 rounded border transition-colors ${isActive ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setEntity('study', slug, meta.title)}
          >
            {isActive ? "Active Globally" : "Set as Active Study"}
          </button>
        </div>
        <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-50">
          <FlaskConical className="h-4 w-4 text-[#56B4E9]" /> {meta.title}
        </h1>
        <p className="mt-0.5 max-w-prose text-xs text-neutral-400">{meta.summary}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500">
          <span>{STATUS_LABEL[meta.status] ?? meta.status}</span>
          <span title={meta.replaces}>replaced the notebook {meta.replaces.split("/").pop()}</span>
          {meta.related?.map((link) => (
            <Link key={link.href} href={link.href} className="text-[#56B4E9] hover:underline">
              {link.label}
            </Link>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ErrorBoundary>
        <div className="mt-4 flex flex-col gap-6">
          <section className="bg-neutral-900/50 p-4 border border-white/10 rounded-md">
            <h2 className="text-lg font-bold text-white mb-2">Introduction</h2>
            <div className="text-sm text-neutral-400">
              <p><strong>Problem Statement:</strong> What question or issue does this study address?</p>
              <p><strong>Context:</strong> Background information and current state.</p>
              <p><strong>Objectives:</strong> The specific goals of this analysis.</p>
            </div>
          </section>
          
          <section className="bg-neutral-900/50 p-4 border border-white/10 rounded-md">
            <h2 className="text-lg font-bold text-white mb-2">Body</h2>
            <div className="text-sm text-neutral-400">
              <p><strong>Data:</strong> Source, range, row counts, and known limitations.</p>
              <p><strong>Analysis:</strong> Methods, parameters, and validation steps.</p>
              <p><strong>Key Findings:</strong> Visualizations and data points proving the insights.</p>
            </div>
          </section>
          
          <section className="bg-neutral-900/50 p-4 border border-white/10 rounded-md">
            <h2 className="text-lg font-bold text-white mb-2">Conclusions</h2>
            <div className="text-sm text-neutral-400">
              <p><strong>Insights:</strong> The central message restated with evidence.</p>
              <p><strong>Recommendations:</strong> Concrete, ordered next steps and actions.</p>
            </div>
          </section>
        </div>

        <div className="mt-8 border-t border-white/10 pt-8">
          <Suspense fallback={<PageLoader />}>
            <Page />
          </Suspense>
        </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}

