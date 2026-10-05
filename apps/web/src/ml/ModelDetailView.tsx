import React, { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { RunConfigurator } from "./RunConfigurator";
import { Responsive } from "react-grid-layout";
import { WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { ArrowLeft, BookOpen, Sparkles, CheckCircle2, Info, Tag, Cpu, Brain, FileText, Play, LineChart, Bot, AlertTriangle, X, GripHorizontal, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CatalogModelDetail } from "@/ml/lib/catalog_types";
import { LiveTelemetryPanel } from "./experiments/LiveTelemetryPanel";
import { useLocation } from "wouter";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import type { CatalogLifecycle } from "@shared/catalogLifecycle";
import { LifecyclePanel } from "./LifecycleStrip";
import { ArchitecturePreview } from "./architecture/ArchitecturePreview";
import { ModelFamilyAnalytics } from "./analytics/ModelFamilyAnalytics";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ModelDetailViewProps {
  model: CatalogModelDetail;
  /** Absent while the lifecycle query is in flight. */
  lifecycle: CatalogLifecycle | undefined;
  onBack: () => void;
  categoryLabels: Record<string, string>;
}

const PANELS = [
  { id: "spec", label: "Blueprint", icon: FileText },
  { id: "analytics", label: "Model Analytics", icon: Activity },
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

  const [activePanels, setActivePanels] = useState<string[]>(["spec", "analytics"]);
  
  // Default grid layouts dictionary for responsive breakpoints
  const [layouts, setLayouts] = useState<any>({
    lg: [
      { i: "spec", x: 0, y: 0, w: 6, h: 22 },
      { i: "analytics", x: 6, y: 0, w: 6, h: 22 }
    ]
  });

  const togglePanel = (id: string) => {
    setActivePanels(current => {
      let nextPanels;
      if (current.includes(id)) {
        nextPanels = current.filter(p => p !== id);
      } else {
        nextPanels = [...current, id];
      }
      
      if (nextPanels.length > 0) {
        const count = nextPanels.length;
        const w = Math.floor(12 / count) || 1;
        
        setLayouts(prev => ({
          ...prev,
          lg: nextPanels.map((p, index) => ({
            i: p,
            x: (index * w) % 12,
            y: 0,
            w: w,
            h: 20
          }))
        }));
      }
      
      return nextPanels;
    });
  };

  const removePanel = (id: string) => {
    setActivePanels(current => current.filter(p => p !== id));
  };

  const onLayoutChange = (currentLayout: any[], allLayouts: any) => {
    // Deep clone to prevent React bail-out from RGL's object mutation
    setLayouts(JSON.parse(JSON.stringify(allLayouts)));
  };

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
      case "analytics":
        return <ModelFamilyAnalytics model={model} />;
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
      <div className="px-6 py-2 border-b border-border/50 bg-muted/10 flex flex-wrap items-center gap-2 shrink-0">
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

      {/* 2D Window Grid Area */}
      <div className="flex-1 overflow-auto bg-neutral-950/20 relative">
        {activePanels.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            Select a panel above to open a window.
          </div>
        ) : (
          <ResponsiveGridLayout
            className="layout w-full min-h-full"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={30}
            onLayoutChange={onLayoutChange}
            draggableHandle=".panel-drag-handle"
            margin={[16, 16]}
          >
            {activePanels.map((panelId) => {
              const panelDef = PANELS.find(p => p.id === panelId);
              const Icon = panelDef?.icon || Info;
              return (
                <div 
                  key={panelId} 
                  className="bg-background border border-border/40 rounded-xl shadow-lg flex flex-col overflow-hidden"
                >
                  {/* Panel Window Header */}
                  <div className="panel-drag-handle flex items-center justify-between px-3 py-2 bg-muted/10 border-b border-border/20 cursor-move hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-2 text-xs font-medium text-foreground select-none">
                      <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground/50" />
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      {panelDef?.label}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 rounded-full hover:bg-destructive/10 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePanel(panelId);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  {/* Panel Content */}
                  <div className="flex-1 min-h-0 relative">
                    {renderPanelContent(panelId)}
                  </div>
                </div>
              );
            })}
          </ResponsiveGridLayout>
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
