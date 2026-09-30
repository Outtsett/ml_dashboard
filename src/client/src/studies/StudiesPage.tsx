/**
 * `/studies`: every study, grouped by category, with the lake views each one
 * reads and whether they are served right now.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FlaskConical, Search } from "lucide-react";
import { allStudies } from "./registry";

interface Listing {
  slug: string;
  datasets: Array<{ name: string; served: boolean }>;
}

async function fetchListing(signal?: AbortSignal): Promise<Map<string, Listing>> {
  const response = await fetch("/api/studies", { signal });
  if (!response.ok) throw new Error(`studies listing failed (${response.status})`);
  const body = (await response.json()) as { studies: Listing[] };
  return new Map(body.studies.map((study) => [study.slug, study]));
}

export default function StudiesPage() {
  const [search, setSearch] = useState("");
  const listing = useQuery({ queryKey: ["studies", "listing"], queryFn: ({ signal }) => fetchListing(signal), staleTime: 60_000 });
  const needle = search.toLowerCase();
  const studies = allStudies().filter((study) => `${study.title} ${study.summary} ${study.category}`.toLowerCase().includes(needle));
  const categories = [...new Set(studies.map((study) => study.category))];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold text-neutral-50">
          <FlaskConical className="h-4 w-4 text-[#56B4E9]" /> Studies
        </h1>
        <p className="text-xs text-neutral-400">
          {allStudies().length} analytic pages, each reading the lake through the dashboard. They replaced the marimo notebooks.
        </p>
        <label className="mt-2 flex max-w-sm items-center gap-2 rounded border border-neutral-700 bg-neutral-950 px-2">
          <Search className="h-3 w-3 text-neutral-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search studies"
            className="h-7 flex-1 bg-transparent text-xs text-neutral-200 outline-none"
          />
        </label>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="mb-1 text-[11px] uppercase tracking-wider text-neutral-500">{category}</h2>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {studies
                .filter((study) => study.category === category)
                .map((study) => {
                  const datasets = listing.data?.get(study.slug)?.datasets ?? [];
                  const missing = datasets.filter((dataset) => !dataset.served);
                  return (
                    <Link
                      key={study.slug}
                      href={`/studies/${study.slug}`}
                      className="block rounded-md border border-neutral-800 bg-neutral-900/40 p-3 hover:border-neutral-600"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-neutral-100">{study.title}</span>
                        {datasets.length > 0 && (
                          <span
                            className={`shrink-0 text-[10px] ${missing.length === 0 ? "text-[#E69F00]" : "text-[#56B4E9]"}`}
                            title={missing.length === 0 ? "Every dataset it reads is served" : `Not landed yet: ${missing.map((d) => d.name).join(", ")}`}
                          >
                            {missing.length === 0 ? "● data ready" : `○ ${missing.length} not landed`}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-3 text-[11px] text-neutral-400">{study.summary}</p>
                    </Link>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
