const fs = require('fs');

const tsxContent = `import React, { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { RunConfigurator } from "./RunConfigurator";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/shared/ui/resizable";

import { ArrowLeft, BookOpen, Sparkles, CheckCircle2, Info, Tag, Cpu, Brain, FileText, Play, LineChart, Bot, AlertTriangle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CatalogModelDetail } from "@/ml/lib/catalog_types";
import { categoryColor } from "./constants";
import { LiveTelemetryPanel } from "./experiments/LiveTelemetryPanel";
import { useLocation } from "wouter";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import type { CatalogLifecycle } from "@shared/catalogLifecycle";
import { LifecyclePanel } from "./LifecycleStrip";
import { ArchitecturePreview } from "./architecture/ArchitecturePreview";

interface ModelDetailViewProps {
  model: CatalogModelDetail;
  /** Absent while the lifecycle query is in flight. */
  lifecycle: CatalogLifecycle | undefined;
  onBack: () => void;
  categoryLabels: Record<string, string>;
}

const PANELS = [
  { id: "spec", label: "Blueprint", icon: FileText },
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

  const [activePanels, setActivePanels] = useState<string[]>(["spec"]);

  const togglePanel = (id: string) => {
    setActivePanels(current => {
      if (current.includes(id)) {
        return current.filter(p => p !== id);
      } else {
        return [...current, id];
      }
    });
  };

  const removePanel = (id: string) => {
    setActivePanels(current => current.filter(p => p !== id));
  };

  const renderPanelContent = (id: string) => {
    switch (id) {
      case "spec":
        return (
          <ScrollArea className="h-full">
            <div className="px-6 pt-6 space-y-6">
              {lifecycle && <LifecyclePanel lifecycle={lifecycle} />}
              <ArchitecturePreview specId={model.id} templateId={lifecycle?.templateId ?? null} />
            </div>
            <div className="p-6 max-w-5xl space-y-6">
              <LiveTelemetryPanel />

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
                                ? `${hp.min} - ${hp.max}`
                                : hp.options?.join(", ") ?? "-"}
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
        );
      case "train":
        return (
          <div className="flex-1 h-full min-h-0 overflow-y-auto p-4">
            <RunConfigurator model={model} />
          </div>
        );
      case "evaluate":
        return <div className="p-8 h-full flex flex-col items-center justify-center text-center text-muted-foreground border border-dashed border-border/50 m-4 rounded-lg">Evaluate Stage (WIP)</div>;
      case "rl":
        return <div className="p-8 h-full flex flex-col items-center justify-center text-center text-muted-foreground border border-dashed border-border/50 m-4 rounded-lg">RL Console (WIP)</div>;
      case "risk":
        return <div className="p-8 h-full flex flex-col items-center justify-center text-center text-muted-foreground border border-dashed border-border/50 m-4 rounded-lg">Risk Assessment (WIP)</div>;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Model Header */}
      <div className="p-6 border-b border-border/50 flex flex-col gap-4 bg-card/30">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0 md:hidden">
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
                <span>•</span>
                <span>v{model.version}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
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
          {model.tags?.map(t => (
            <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 bg-muted/50">
              {t}
            </Badge>
          ))}
          {trainableKey && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[hsl(var(--data-pos))] text-[hsl(var(--data-pos))]">
              Trainable
            </Badge>
          )}
        </div>
      </div>

      {/* Tiling Controls */}
      <div className="px-6 py-2 border-b border-border/50 bg-muted/10 flex flex-wrap items-center gap-2">
        {PANELS.map(panel => {
          const disabled = panel.id === "train" && !trainableKey;
          const isActive = activePanels.includes(panel.id);
          const Icon = panel.icon;
          return (
            <Button
              key={panel.id}
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              disabled={disabled}
              onClick={() => togglePanel(panel.id)}
              className="h-7 text-xs px-2"
            >
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {panel.label}
            </Button>
          );
        })}
      </div>

      {/* Split Pane Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activePanels.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Select a panel above to view details.
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal">
            {activePanels.map((panelId, index) => {
              const panelDef = PANELS.find(p => p.id === panelId);
              const Icon = panelDef?.icon || Info;
              return (
                <React.Fragment key={panelId}>
                  <ResizablePanel minSize={15} defaultSize={100 / activePanels.length}>
                    <div className="flex flex-col h-full bg-background border-r border-border/30 last:border-0">
                      {/* Panel Header */}
                      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/5 border-b border-border/30">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          {panelDef?.label}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removePanel(panelId)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      {/* Panel Content */}
                      <div className="flex-1 min-h-0 h-full overflow-hidden">
                        {renderPanelContent(panelId)}
                      </div>
                    </div>
                  </ResizablePanel>
                  {index < activePanels.length - 1 && <ResizableHandle withHandle />}
                </React.Fragment>
              );
            })}
          </ResizablePanelGroup>
        )}
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
`;

fs.writeFileSync('apps/web/src/ml/ModelDetailView.tsx', tsxContent);
