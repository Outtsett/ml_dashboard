import React, { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { RunConfigurator } from "./RunConfigurator";

import { ArrowLeft, BookOpen, Sparkles, CheckCircle2, Info, Tag, Cpu, Brain, FileText, Play, LineChart, Bot, AlertTriangle, Activity, Gauge, Footprints } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CatalogModelDetail } from "@/ml/lib/catalog_types";
import { LiveTelemetryPanel } from "./experiments/LiveTelemetryPanel";
import { useLocation } from "wouter";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import type { CatalogLifecycle } from "@shared/catalogLifecycle";
import { LifecyclePanel } from "./LifecycleStrip";
import { ArchitecturePreview } from "./architecture/ArchitecturePreview";
import { ModelRunsPanel } from "./metrics/ModelRunsPanel";
import { SpecificationMetricsPanel } from "./metrics/panels";
import { HowItWorksPanel } from "./explainer/HowItWorksPanel";

interface ModelDetailViewProps {
  model: CatalogModelDetail;
  /** Absent while the lifecycle query is in flight. */
  lifecycle: CatalogLifecycle | undefined;
  onBack: () => void;
  categoryLabels: Record<string, string>;
}

const PANELS = [
  // the model in plain words: its steps, what to use it for, one worked example
  { id: "how", label: "How it works", icon: Footprints },
  // how this model is judged: its metrics, their types and roles, and why each applies
  { id: "metrics", label: "Metrics", icon: Gauge },
  { id: "spec", label: "Blueprint", icon: FileText },
  // the model's measured results: its real runs, or a statement that it has none
  { id: "analytics", label: "Runs", icon: Activity },
  { id: "train", label: "Pipeline", icon: Play },
  { id: "evaluate", label: "Evaluate", icon: LineChart },
  { id: "rl", label: "RL Console", icon: Bot },
  { id: "risk", label: "Risk", icon: AlertTriangle }
];

export function ModelDetailView({
  model,
  lifecycle,
  onBack,
  categoryLabels,
}: ModelDetailViewProps) {
  const [, navigate] = useLocation();
  const trainableKey = lifecycle?.trainableKey ?? null;

  const { setEntity, activeEntity } = useEntityStore();
  const isActive = activeEntity?.type === 'model' && activeEntity?.id === model.id;

  // One panel at a time, in place: the tab strip picks it.
  const [activePanel, setActivePanel] = useState<string>("how");

  const renderPanelContent = (id: string) => {
    switch (id) {
      case "spec":
        return (
          <ScrollArea className="h-full w-full">
            <div className="px-6 pt-6 space-y-6">
              {lifecycle && <LifecyclePanel lifecycle={lifecycle} />}
              <ArchitecturePreview specId={model.id} templateId={lifecycle?.templateId ?? null} />
            </div>
            <div className="p-6 max-w-5xl space-y-6">
              <LiveTelemetryPanel />

              {model.overview && (
                <section>
                  <SectionHeader icon={BookOpen} title="Overview" />
                  <p className="text-sm text-muted-foreground leading-relaxed mt-2">{model.overview}</p>
                </section>
              )}

              {model.keyFeatures.length > 0 && (
                <section>
                  <SectionHeader icon={Sparkles} title="Key Features" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                    {model.keyFeatures.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 p-2.5 rounded-md bg-muted/30 border border-border/50">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--data-pos))] mt-0.5 shrink-0" />
                        <span className="text-xs text-muted-foreground leading-relaxed">{f}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

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

              {model.variants.length > 0 && (
                <section>
                  <SectionHeader icon={Tag} title="Variants" />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {model.variants.map((v, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{v}</Badge>
                    ))}
                  </div>
                </section>
              )}

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
                          <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono text-primary">{hp.name}</td>
                            <td className="px-3 py-2"><Badge variant="outline" className="text-[10px] py-0">{hp.type}</Badge></td>
                            <td className="px-3 py-2 font-mono">{String(hp.default)}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {hp.type === "number" && hp.min != null && hp.max != null
                                ? `${hp.min} - ${hp.max}`
                                : hp.options?.join(", ") ?? "-"}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{hp.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {model.applications.length > 0 && (
                <section>
                  <SectionHeader icon={Brain} title="Applications" />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {model.applications.map((a, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                    ))}
                  </div>
                </section>
              )}

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
        );
      case "how":
        return (
          <ScrollArea className="h-full w-full">
            <HowItWorksPanel specificationId={model.id} name={model.name} />
          </ScrollArea>
        );
      case "metrics":
        return (
          <ScrollArea className="h-full w-full">
            <div className="p-4">
              <SpecificationMetricsPanel specificationId={model.id} name={model.name} />
            </div>
          </ScrollArea>
        );
      case "analytics":
        return (
          <ScrollArea className="h-full w-full">
            <div className="p-4">
              <ModelRunsPanel specificationId={model.id} name={model.name} />
            </div>
          </ScrollArea>
        );
      case "train":
        return (
          <div className="h-full w-full overflow-y-auto p-4">
            <RunConfigurator model={model} />
          </div>
        );
      case "evaluate":
        return <div className="p-8 h-full flex flex-col items-center justify-center text-center text-muted-foreground border-border/50">Evaluate Stage (WIP)</div>;
      case "rl":
        return <div className="p-8 h-full flex flex-col items-center justify-center text-center text-muted-foreground border-border/50">RL Console (WIP)</div>;
      case "risk":
        return <div className="p-8 h-full flex flex-col items-center justify-center text-center text-muted-foreground border-border/50">Risk Assessment (WIP)</div>;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Model Header */}
      <div className="p-6 border-b border-border/50 flex flex-col gap-4 bg-card/30 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0" title="Back to the category" aria-label="Back to the category">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-display font-bold truncate flex items-center gap-2">
                {model.name}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                <span className="font-mono">{model.id}</span>
                <span>•</span>
                <span>{categoryLabels[model.category] ?? model.category}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#E69F00]/50 bg-[#E69F00]/10 hover:bg-[#E69F00]/20 text-[#E69F00] hover:text-white font-mono text-xs transition-colors"
              onClick={() => {
                setEntity("model", model.id, model.name);
                navigate(`/training?tab=analytics&model=${encodeURIComponent(model.id)}`);
              }}
              title="Open full 4-stage DIKW telemetry in Model Analytics"
            >
              <Activity className="h-3.5 w-3.5 text-[#E69F00]" />
              <span>Model Analytics</span>
            </Button>
            <Button 
              variant={isActive ? "secondary" : "default"}
              size="sm"
              onClick={() => setEntity("model", model.id, model.name)}
            >
              {isActive ? "Active Globally" : "Set Active"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {trainableKey && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[hsl(var(--data-pos))] text-[hsl(var(--data-pos))]">
              Trainable
            </Badge>
          )}
        </div>
      </div>

      {/* Panel tabs */}
      <div role="tablist" aria-label="Model panels" className="px-6 py-2 border-b border-border/50 bg-muted/10 flex flex-wrap items-center gap-2 shrink-0">
        {PANELS.map(panel => {
          const disabled = panel.id === "train" && !trainableKey;
          const isSelected = activePanel === panel.id;
          const Icon = panel.icon;
          return (
            <Button
              key={panel.id}
              role="tab"
              aria-selected={isSelected}
              variant={isSelected ? "secondary" : "ghost"}
              size="sm"
              disabled={disabled}
              onClick={() => setActivePanel(panel.id)}
              className="h-7 text-xs px-2"
            >
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {panel.label}
            </Button>
          );
        })}
      </div>

      {/* The selected panel, filling the page */}
      <div role="tabpanel" className="flex-1 min-h-0 overflow-hidden bg-background relative">
        {renderPanelContent(activePanel)}
      </div>
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
