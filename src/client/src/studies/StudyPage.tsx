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
        <Link href="/studies" className="text-[#56B4E9] underline">All studies</Link>
      </div>
    );
  }
  const { meta } = entry;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <Link href="/studies" className="mb-1 inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300">
          <ArrowLeft className="h-3 w-3" /> Studies · {meta.category}
        </Link>
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
          <Suspense fallback={<PageLoader />}>
            <Page />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
