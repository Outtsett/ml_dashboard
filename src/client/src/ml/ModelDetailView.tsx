
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  ArrowLeft,
  BookOpen,
  Sparkles,
  CheckCircle2,
  Info,
  Tag,
  Cpu,
  Brain,
  FileText,
  Play,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CatalogModelDetail } from "@/ml/lib/catalog_types";
import { categoryColor } from "./constants";
import { ModelWizard } from "./experiments/ModelWizard";
import { LiveTelemetryPanel } from "./experiments/LiveTelemetryPanel";
import { useState } from "react";

interface ModelDetailViewProps {
  model: CatalogModelDetail;
  onBack: () => void;
  categoryLabels: Record<string, string>;
}

export function ModelDetailView({
  model,
  onBack,
  categoryLabels,
}: ModelDetailViewProps) {
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-display font-semibold truncate">
              {model.name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={`${categoryColor(model.category)} border text-[10px]`}>
                {categoryLabels[model.category] ?? model.category}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                {model.subcategory.replace(/-/g, " ")}
              </Badge>
              {model.shortName !== model.name && (
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {model.shortName}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Button 
          className="shadow-[0_0_15px_rgba(var(--primary),0.3)] hover:shadow-[0_0_25px_rgba(var(--primary),0.5)] transition-shadow duration-300 ml-4"
          onClick={() => setIsWizardOpen(true)}
        >
          <Play className="h-4 w-4 mr-2" /> Configure & Train
        </Button>
      </div>

      <ModelWizard 
        model={model} 
        isOpen={isWizardOpen} 
        onClose={() => setIsWizardOpen(false)} 
      />

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-5xl space-y-6">
          <LiveTelemetryPanel />
          {/* Mechanism animation — the same engine and registry as
              /architecture -> Mechanism, shown here because this is where the
              model is actually being read. Renders a stated reason for catalog
              specs with no researched entry; never a lookalike. */}
          {/* Mechanism animation placeholder */}
          <div className="bg-[#0a0a0a] border border-neutral-800 rounded p-4 text-center text-neutral-500 font-mono text-sm">
            Architecture preview for {model.id}
          </div>

          {/* Overview */}
          {model.overview && (
            <section>
              <SectionHeader icon={BookOpen} title="Overview" />
              <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                {model.overview}
              </p>
            </section>
          )}

          {/* Key Features */}
          {model.keyFeatures.length > 0 && (
            <section>
              <SectionHeader icon={Sparkles} title="Key Features" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                {model.keyFeatures.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-border/50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--data-pos))] mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground leading-relaxed">{f}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Principles */}
          {model.principles.length > 0 && (
            <section>
              <SectionHeader icon={Info} title="Core Principles" />
              <ul className="mt-2 space-y-1.5">
                {model.principles.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="text-primary font-mono text-[10px] mt-0.5">{i + 1}.</span>
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Variants */}
          {model.variants.length > 0 && (
            <section>
              <SectionHeader icon={Tag} title="Variants" />
              <div className="flex flex-wrap gap-2 mt-2">
                {model.variants.map((v, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {v}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Hyperparameters */}
          {model.hyperparameters.length > 0 && (
            <section>
              <SectionHeader icon={Cpu} title="Hyperparameters" />
              <div className="mt-2 border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium">Default</th>
                      <th className="text-left px-3 py-2 font-medium">Range</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.hyperparameters.map((hp, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-3 py-2 font-mono text-primary">{hp.name}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {hp.type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono">{String(hp.default)}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {hp.type === "number" && hp.min != null && hp.max != null
                            ? `${hp.min} — ${hp.max}`
                            : hp.options?.join(", ") ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">
                          {hp.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Applications */}
          {model.applications.length > 0 && (
            <section>
              <SectionHeader icon={Brain} title="Applications" />
              <div className="flex flex-wrap gap-2 mt-2">
                {model.applications.map((a, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="text-xs"
                  >
                    {a}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {/* Raw Markdown */}
          {model.rawMarkdown && (
            <section>
              <SectionHeader icon={FileText} title="Raw Specification" />
              <pre className="mt-2 p-4 bg-muted/30 border border-border rounded-md text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground overflow-x-auto max-h-[600px] overflow-y-auto">
                {model.rawMarkdown}
              </pre>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <h3 className="text-sm font-semibold font-display flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      {title}
    </h3>
  );
}
