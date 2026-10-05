import React, { useState } from "react";
import { useParams } from "wouter";
import * as Tabs from "@radix-ui/react-tabs";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useEntityStore, type EntityType } from "@/shared/contexts/EntityContext";
import { useEntityProfile } from "./useEntityProfile";
import { EntityRelationships } from "./EntityRelationships";
import { EntityMetrics } from "./EntityMetrics";
import { 
  Activity, 
  Network, 
  FileText, 
  GitCommit, 
  Info,
  Calendar,
  Clock,
  Tag,
  MessageSquare,
  ScatterChart
} from "lucide-react";
import { KronosAnalyticsTab } from "./analytics/KronosAnalyticsTab";
import { FinbertAnalyticsTab } from "./analytics/FinbertAnalyticsTab";
import { HmmAnalyticsTab } from "./analytics/HmmAnalyticsTab";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import RegressionPage from "@/market/regression/RegressionPage";

export default function EntityProfilePage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const { setEntity, activeEntity } = useEntityStore();
  const [annotationText, setAnnotationText] = useState("");
  
  const { 
    profile, 
    isLoadingProfile, 
    relationships, 
    metrics, 
    annotations, 
    lineage,
    addAnnotation,
    isAddingAnnotation
  } = useEntityProfile(type, id);

  if (isLoadingProfile) {
    return <PageLoader />;
  }

  const handleSetTarget = () => {
    if (profile) {
      setEntity(type as EntityType, id, profile.name || id);
    } else {
      setEntity(type as EntityType, id, id);
    }
  };

  const isActive = activeEntity?.id === id && activeEntity?.type === type;
  
  const handleAddAnnotation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!annotationText.trim()) return;
    addAnnotation(annotationText);
    setAnnotationText("");
  };

  // Determine specific model architecture
  let modelArch = "Generic";
  if (type === 'model') {
    const searchStr = (profile?.name + " " + id + " " + JSON.stringify(profile?.tags || [])).toLowerCase();
    if (searchStr.includes("kronos")) modelArch = "Kronos";
    else if (searchStr.includes("finbert") || searchStr.includes("bert")) modelArch = "FinBERT";
    else if (searchStr.includes("hmm") || searchStr.includes("markov")) modelArch = "HMM";
  }

  return (
    <div className="flex flex-col h-full bg-neutral-950 overflow-hidden text-neutral-200">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-neutral-800 bg-neutral-900/40 shrink-0">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 uppercase tracking-wider">
              {type}
            </Badge>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {profile?.name || id}
            </h1>
            {profile?.status && (
              <Badge variant="secondary" className="bg-neutral-800 text-neutral-300 ml-2">
                {profile.status}
              </Badge>
            )}
          </div>
          <p className="text-sm text-neutral-400 max-w-2xl">
            {profile?.description || "No description available for this entity."}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button 
            variant={isActive ? "secondary" : "default"}
            onClick={handleSetTarget}
            className={isActive ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-blue-600 hover:bg-blue-700 text-white"}
          >
            {isActive ? "Active Entity" : "Set as Active"}
          </Button>
        </div>
      </div>

      {/* Content area with Tabs */}
      <Tabs.Root defaultValue="overview" className="flex flex-col flex-1 overflow-hidden">
        <div className="border-b border-neutral-800 px-6 shrink-0">
          <Tabs.List className="flex gap-6 h-12 items-center">
            <Tabs.Trigger 
              value="overview" 
              className="h-full flex items-center gap-2 px-1 text-sm font-medium text-neutral-400 hover:text-neutral-200 data-[state=active]:text-emerald-400 data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 transition-colors"
            >
              <Info className="h-4 w-4" />
              Overview
            </Tabs.Trigger>
            
            <Tabs.Trigger 
              value="relationships" 
              className="h-full flex items-center gap-2 px-1 text-sm font-medium text-neutral-400 hover:text-neutral-200 data-[state=active]:text-blue-400 data-[state=active]:border-b-2 data-[state=active]:border-blue-500 transition-colors"
            >
              <Network className="h-4 w-4" />
              Relationships
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] bg-neutral-800">{relationships?.length || 0}</Badge>
            </Tabs.Trigger>

            {type === 'model' && (
              <>
                <Tabs.Trigger 
                  value="metrics" 
                  className="h-full flex items-center gap-2 px-1 text-sm font-medium text-neutral-400 hover:text-neutral-200 data-[state=active]:text-amber-400 data-[state=active]:border-b-2 data-[state=active]:border-amber-500 transition-colors"
                >
                  <Activity className="h-4 w-4" />
                  Metrics
                </Tabs.Trigger>
                <Tabs.Trigger 
                  value="regression" 
                  className="h-full flex items-center gap-2 px-1 text-sm font-medium text-neutral-400 hover:text-neutral-200 data-[state=active]:text-cyan-400 data-[state=active]:border-b-2 data-[state=active]:border-cyan-500 transition-colors"
                >
                  <ScatterChart className="h-4 w-4" />
                  Regression Analysis
                </Tabs.Trigger>
              </>
            )}

            <Tabs.Trigger 
              value="annotations" 
              className="h-full flex items-center gap-2 px-1 text-sm font-medium text-neutral-400 hover:text-neutral-200 data-[state=active]:text-purple-400 data-[state=active]:border-b-2 data-[state=active]:border-purple-500 transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              Annotations
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] bg-neutral-800">{annotations?.length || 0}</Badge>
            </Tabs.Trigger>

            <Tabs.Trigger 
              value="lineage" 
              className="h-full flex items-center gap-2 px-1 text-sm font-medium text-neutral-400 hover:text-neutral-200 data-[state=active]:text-rose-400 data-[state=active]:border-b-2 data-[state=active]:border-rose-500 transition-colors"
            >
              <GitCommit className="h-4 w-4" />
              Lineage
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-neutral-950/50">
          <Tabs.Content value="overview" className="h-full focus:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="col-span-1 md:col-span-2 flex flex-col gap-6">
                {/* Details Card */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h3 className="text-lg font-medium text-white mb-4">Entity Details</h3>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-500 uppercase tracking-wider flex items-center gap-1"><Tag className="h-3 w-3" /> ID</span>
                      <span className="text-sm text-neutral-300 font-mono">{id}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-500 uppercase tracking-wider flex items-center gap-1"><Calendar className="h-3 w-3" /> Created</span>
                      <span className="text-sm text-neutral-300">
                        {profile?.createdAt ? new Date(profile.createdAt).toLocaleString() : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-neutral-500 uppercase tracking-wider flex items-center gap-1"><Clock className="h-3 w-3" /> Last Modified</span>
                      <span className="text-sm text-neutral-300">
                        {profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString() : 'Unknown'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Quick Stats sidebar */}
              <div className="col-span-1 flex flex-col gap-4">
                <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5">
                  <h3 className="text-sm font-medium text-neutral-300 mb-4 uppercase tracking-wider">Quick Stats</h3>
                  {type === 'model' && metrics && metrics.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {Object.entries((metrics[metrics.length - 1] || {}) as Record<string, any>)
                        .filter(([k]) => k !== 'timestamp')
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between items-center pb-2 border-b border-neutral-800 last:border-0 last:pb-0">
                            <span className="text-sm text-neutral-400 capitalize">{k.replace(/_/g, ' ')}</span>
                            <span className="text-sm font-medium text-emerald-400">{typeof v === 'number' ? v.toFixed(4) : v}</span>
                          </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-500 italic">No stats available</div>
                  )}
                </div>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="relationships" className="h-full focus:outline-none">
            <EntityRelationships relationships={relationships || []} currentId={id} />
          </Tabs.Content>

          {type === 'model' && (
            <>
              <Tabs.Content value="metrics" className="h-full focus:outline-none">
                <EntityMetrics metrics={metrics || []} />
              </Tabs.Content>
              {modelArch === 'Kronos' && (
                <Tabs.Content value="kronos" className="h-full focus:outline-none">
                  <KronosAnalyticsTab profileId={id} />
                </Tabs.Content>
              )}
              {modelArch === 'FinBERT' && (
                <Tabs.Content value="finbert" className="h-full focus:outline-none">
                  <FinbertAnalyticsTab profileId={id} />
                </Tabs.Content>
              )}
              {modelArch === 'HMM' && (
                <Tabs.Content value="hmm" className="h-full focus:outline-none">
                  <HmmAnalyticsTab profileId={id} />
                </Tabs.Content>
              )}
              <Tabs.Content value="regression" className="h-full focus:outline-none flex flex-col">
                <RegressionPage />
              </Tabs.Content>
            </>
          )}

          <Tabs.Content value="annotations" className="h-full focus:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 flex flex-col gap-4">
                {annotations && annotations.length > 0 ? (
                  annotations.map((ann) => (
                    <div key={ann.id} className="p-4 bg-neutral-900 border border-neutral-800 rounded-lg">
                      <div className="text-xs text-neutral-500 mb-2 flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {new Date(ann.createdAt).toLocaleString()}
                      </div>
                      <p className="text-sm text-neutral-200 whitespace-pre-wrap">{ann.content}</p>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center p-12 text-neutral-500 border border-neutral-800 rounded-lg bg-neutral-900/50">
                    <FileText className="h-8 w-8 mb-3 opacity-20" />
                    <p>No annotations yet.</p>
                  </div>
                )}
              </div>
              
              <div className="md:col-span-1">
                <form onSubmit={handleAddAnnotation} className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 sticky top-0">
                  <h3 className="text-sm font-medium text-neutral-300 mb-3">Add Annotation</h3>
                  <textarea
                    value={annotationText}
                    onChange={(e) => setAnnotationText(e.target.value)}
                    placeholder="Type your notes, observations, or cross-references here..."
                    className="w-full h-32 bg-neutral-950 border border-neutral-800 rounded-md p-3 text-sm text-neutral-200 focus:outline-none focus:border-purple-500 resize-none mb-4"
                  />
                  <Button 
                    type="submit" 
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={!annotationText.trim() || isAddingAnnotation}
                  >
                    {isAddingAnnotation ? "Saving..." : "Save Annotation"}
                  </Button>
                </form>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="lineage" className="h-full focus:outline-none">
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-6 flex items-center gap-2">
                <GitCommit className="h-5 w-5 text-rose-500" />
                Lineage Details
              </h3>
              
              {lineage ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="flex flex-col gap-4">
                    <h4 className="text-sm font-medium text-neutral-400 uppercase tracking-wider border-b border-neutral-800 pb-2">Training Configuration</h4>
                    <div className="bg-neutral-950 p-3 rounded border border-neutral-800/50">
                      <div className="text-xs text-neutral-500 mb-1">Dataset Version</div>
                      <div className="text-sm font-mono text-neutral-300">{lineage.datasetVersion || 'N/A'}</div>
                    </div>
                    <div className="bg-neutral-950 p-3 rounded border border-neutral-800/50">
                      <div className="text-xs text-neutral-500 mb-1">Features Used</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {lineage.features ? lineage.features.map((f: string) => (
                          <Badge key={f} variant="outline" className="text-[10px] bg-neutral-900 border-neutral-700">{f}</Badge>
                        )) : <span className="text-sm text-neutral-500">None recorded</span>}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-4">
                    <h4 className="text-sm font-medium text-neutral-400 uppercase tracking-wider border-b border-neutral-800 pb-2">Validation & Monitoring</h4>
                    <div className="bg-neutral-950 p-3 rounded border border-neutral-800/50">
                      <div className="text-xs text-neutral-500 mb-1">Walk-Forward Fold</div>
                      <div className="text-sm text-neutral-300">{lineage.walkForwardFold || 'N/A'}</div>
                    </div>
                    <div className="bg-neutral-950 p-3 rounded border border-neutral-800/50">
                      <div className="text-xs text-neutral-500 mb-1">Drift Status</div>
                      <div className="text-sm flex items-center gap-2 mt-1">
                        {lineage.driftDetected ? (
                          <><Badge className="bg-red-500/20 text-red-400 hover:bg-red-500/30">Drift Detected</Badge></>
                        ) : (
                          <><Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">Stable</Badge></>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-neutral-500">
                  Detailed lineage data is not available for this entity.
                </div>
              )}
            </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}

