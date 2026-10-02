/**
 * "Read by these studies": links from any page to the studies whose server
 * handler reads a given lake view, from GET /api/studies (each handler
 * declares its `datasets`). Renders nothing while loading or when no study
 * reads it. Replaced the marimo-era ReadByNotebooks.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FlaskConical } from "lucide-react";
import { allStudies } from "./registry";

interface Listing {
  slug: string;
  datasets: Array<{ name: string; served: boolean }>;
}

/** True when a study's dataset `name` covers `table`: the same view, or a
 *  family the table belongs to (`derived_model_cycle_runs` covers
 *  `derived_model_cycle_runs_runs`). */
export function datasetCovers(name: string, table: string): boolean {
  const declared = name.toLowerCase();
  const wanted = table.toLowerCase();
  return declared === wanted || wanted.startsWith(`${declared}_`) || declared.startsWith(`${wanted}_`);
}

async function fetchListing(signal?: AbortSignal): Promise<Listing[]> {
  const response = await fetch("/api/studies", { signal });
  if (!response.ok) throw new Error(`studies listing failed (${response.status})`);
  return ((await response.json()) as { studies: Listing[] }).studies;
}

export function ReadByStudies({ tables, prefix = "Read by" }: { tables: string[]; prefix?: string }) {
  const listing = useQuery({ queryKey: ["studies", "listing-raw"], queryFn: ({ signal }) => fetchListing(signal), staleTime: 5 * 60_000 });
  const titles = new Map(allStudies().map((study) => [study.slug, study.title]));
  const readers = (listing.data ?? []).filter(
    (study) => titles.has(study.slug) && study.datasets.some((dataset) => tables.some((table) => datasetCovers(dataset.name, table))),
  );
  if (readers.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="read-by-studies">
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      {prefix}
      {readers.map((study) => (
        <Link key={study.slug} href={`/studies/${study.slug}`} className="text-foreground underline decoration-dotted underline-offset-2 hover:text-primary">
          {titles.get(study.slug)}
        </Link>
      ))}
    </span>
  );
}
