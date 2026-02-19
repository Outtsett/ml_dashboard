import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis
} from "recharts";
import { Target, Layers, Grid3X3, AlertTriangle, TrendingUp, Database } from "lucide-react";
import {
  MODEL_SUBCATEGORIES,
  METRIC_DEFINITIONS,
  formatMetricValue,
  type MetricKey
} from "@shared/mlTaxonomy";

interface CategoryMetricsProps {
  subcategory: string;
  metrics: Record<string, number | any>;
  className?: string;
}

function NoDataPlaceholder({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      <div className="text-center">
        <Database className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
        <p className="text-xs">{message}</p>
        <p className="text-[10px] mt-0.5 opacity-60">Train models to populate</p>
      </div>
    </div>
  );
}

function MetricCard({ metricKey, value, color }: { metricKey: string; value: number | null | undefined; color: string }) {
  const def = METRIC_DEFINITIONS[metricKey as MetricKey];
  const colorClasses: Record<string, string> = {
    green: 'text-emerald-500',
    blue: 'text-blue-500',
    violet: 'text-violet-400',
    amber: 'text-amber-500',
    cyan: 'text-cyan-500',
  };
  
  return (
    <div className="bg-black/20 border border-white/5 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{def?.name || metricKey}</div>
      <div className={`text-lg font-mono font-medium ${colorClasses[color] || 'text-white'}`}>
        {value != null ? formatMetricValue(metricKey as MetricKey, value) : '--'}
      </div>
    </div>
  );
}

const chartTooltipStyle = { 
  backgroundColor: 'hsl(220, 15%, 10%)', 
  borderRadius: '3px', 
  border: '1px solid hsl(220, 15%, 20%)', 
  fontSize: '11px',
  padding: '6px 10px'
};

export function ClassificationMetrics({ metrics }: { metrics: Record<string, number | any> }) {
  const hasConfusionMatrix = metrics.tp != null && metrics.tn != null && metrics.fp != null && metrics.fn != null;
  const confusionData = hasConfusionMatrix ? [
    { name: 'TP', value: metrics.tp },
    { name: 'TN', value: metrics.tn },
    { name: 'FP', value: metrics.fp },
    { name: 'FN', value: metrics.fn },
  ] : null;
  
  const COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#f59e0b'];
  
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard metricKey="accuracy" value={metrics.accuracy ?? metrics.finalAccuracy} color="green" />
        <MetricCard metricKey="precision" value={metrics.precision} color="green" />
        <MetricCard metricKey="recall" value={metrics.recall} color="green" />
        <MetricCard metricKey="f1" value={metrics.f1} color="green" />
      </div>
      
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-1.5 pt-2.5 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            <Grid3X3 className="h-3.5 w-3.5" />
            Confusion Matrix
            {!confusionData && <span className="ml-auto text-[9px] opacity-60 normal-case">Requires TP/TN/FP/FN</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-36 px-3 pb-3">
          {confusionData ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={confusionData} innerRadius={30} outerRadius={50} paddingAngle={1} dataKey="value">
                  {confusionData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <NoDataPlaceholder message="No confusion matrix data" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function RegressionMetrics({ metrics }: { metrics: Record<string, number | any> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard metricKey="mae" value={metrics.mae} color="blue" />
        <MetricCard metricKey="rmse" value={metrics.rmse} color="blue" />
        <MetricCard metricKey="mape" value={metrics.mape} color="blue" />
        <MetricCard metricKey="r2" value={metrics.r2} color="blue" />
      </div>
      
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-1.5 pt-2.5 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            <TrendingUp className="h-3.5 w-3.5" />
            Predicted vs Actual
            <span className="ml-auto text-[9px] opacity-60 normal-case">Requires predictions array</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-36 px-3 pb-3">
          <NoDataPlaceholder message="No prediction data available" />
        </CardContent>
      </Card>
    </div>
  );
}

const CLUSTER_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', '#ef4444', '#ec4899', '#3b82f6', '#84cc16'];

export function ClusteringMetrics({ metrics }: { metrics: Record<string, number | any> }) {
  const hasClusterPoints = Array.isArray(metrics.clusterPoints) && metrics.clusterPoints.length > 0;
  
  // Filter valid points and extract unique cluster IDs
  const validPoints = hasClusterPoints 
    ? metrics.clusterPoints.filter((pt: any) => 
        pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) && pt.cluster != null
      )
    : [];
  
  // Build cluster metadata with consistent ID mapping
  const uniqueClusterIds = Array.from(new Set(validPoints.map((pt: any) => pt.cluster))).sort((a: any, b: any) => a - b);
  const clusterIdToIndex = new Map(uniqueClusterIds.map((id, idx) => [id, idx]));
  
  // Group points by cluster with proper ID mapping
  const clusterPointsByGroup = validPoints.length > 0
    ? validPoints.reduce((acc: Record<string, any[]>, pt: any) => {
        const key = String(pt.cluster);
        if (!acc[key]) acc[key] = [];
        acc[key].push(pt);
        return acc;
      }, {} as Record<string, any[]>)
    : null;
  
  // Calculate cluster sizes from points if not provided, or use provided sizes
  const hasClusterSizes = Array.isArray(metrics.clusterSizes) && metrics.clusterSizes.length > 0;
  const clusterData = hasClusterSizes 
    ? metrics.clusterSizes.map((size: number, i: number) => ({ 
        name: `C${i + 1}`, 
        clusterId: i,
        size,
        fill: CLUSTER_COLORS[i % CLUSTER_COLORS.length]
      }))
    : clusterPointsByGroup
      ? uniqueClusterIds.map((clusterId: any, i: number) => ({
          name: `C${i + 1}`,
          clusterId,
          size: clusterPointsByGroup[String(clusterId)]?.length || 0,
          fill: CLUSTER_COLORS[i % CLUSTER_COLORS.length]
        }))
      : null;
  
  // Silhouette per cluster with consistent cluster ordering
  const hasSilhouettePerCluster = Array.isArray(metrics.silhouettePerCluster) && metrics.silhouettePerCluster.length > 0;
  const silhouetteData = hasSilhouettePerCluster
    ? metrics.silhouettePerCluster.map((score: number, i: number) => ({
        name: `C${i + 1}`,
        score: Number.isFinite(score) ? score : 0,
        fill: score >= 0.5 ? '#22c55e' : score >= 0.25 ? '#f59e0b' : '#ef4444'
      }))
    : null;
  
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard metricKey="silhouetteScore" value={metrics.silhouetteScore ?? metrics.silhouette_score} color="violet" />
        <MetricCard metricKey="daviesBouldin" value={metrics.daviesBouldin ?? metrics.davies_bouldin} color="violet" />
        <MetricCard metricKey="calinskiHarabasz" value={metrics.calinskiHarabasz ?? metrics.calinski_harabasz} color="violet" />
        <MetricCard metricKey="numClusters" value={metrics.numClusters ?? metrics.n_clusters} color="violet" />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-black/20 border-white/10">
          <CardHeader className="pb-1 pt-2.5 px-3">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
              <Grid3X3 className="h-3.5 w-3.5" />
              Cluster Groups
              {!clusterPointsByGroup && <span className="ml-auto text-[9px] opacity-60 normal-case">2D projection</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-44 px-2 pb-2">
            {clusterPointsByGroup ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(220, 15%, 15%)" />
                  <XAxis type="number" dataKey="x" stroke="hsl(220, 10%, 40%)" fontSize={8} tickLine={false} axisLine={false} />
                  <YAxis type="number" dataKey="y" stroke="hsl(220, 10%, 40%)" fontSize={8} tickLine={false} axisLine={false} width={25} />
                  <ZAxis range={[20, 60]} />
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(val: number) => val.toFixed(3)} />
                  {Object.entries(clusterPointsByGroup).map(([clusterId, points]) => {
                    const colorIndex = clusterIdToIndex.get(isNaN(Number(clusterId)) ? clusterId : Number(clusterId)) ?? 0;
                    return (
                      <Scatter 
                        key={clusterId} 
                        name={`Cluster ${colorIndex + 1}`} 
                        data={points as any[]} 
                        fill={CLUSTER_COLORS[colorIndex % CLUSTER_COLORS.length]}
                        opacity={0.7}
                      />
                    );
                  })}
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <NoDataPlaceholder message="No cluster points (requires clusterPoints array with x, y, cluster)" />
            )}
          </CardContent>
        </Card>
        
        <Card className="bg-black/20 border-white/10">
          <CardHeader className="pb-1 pt-2.5 px-3">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
              <Layers className="h-3.5 w-3.5" />
              Cluster Sizes
              {!clusterData && <span className="ml-auto text-[9px] opacity-60 normal-case">Requires clusterSizes</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-44 px-2 pb-2">
            {clusterData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clusterData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(220, 15%, 15%)" vertical={false} />
                  <XAxis dataKey="name" stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} width={30} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="size" radius={[2, 2, 0, 0]}>
                    {clusterData.map((entry: { name: string; size: number; fill: string }, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <NoDataPlaceholder message="No cluster size data" />
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-1.5 pt-2.5 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            <Target className="h-3.5 w-3.5" />
            Silhouette per Cluster
            {!silhouetteData && <span className="ml-auto text-[9px] opacity-60 normal-case">Requires silhouettePerCluster array</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-28 px-3 pb-3">
          {silhouetteData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={silhouetteData} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(220, 15%, 15%)" horizontal={false} />
                <XAxis type="number" domain={[-1, 1]} stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} width={25} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(val: number) => val.toFixed(3)} />
                <Bar dataKey="score" radius={[0, 2, 2, 0]}>
                  {silhouetteData.map((entry: { name: string; score: number; fill: string }, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataPlaceholder message="No per-cluster silhouette data" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AnomalyMetrics({ metrics }: { metrics: Record<string, number | any> }) {
  const hasScoreDistribution = Array.isArray(metrics.scoreDistribution) && metrics.scoreDistribution.length > 0;
  
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard metricKey="anomalyRate" value={metrics.anomalyRate ?? metrics.anomaly_rate} color="amber" />
        <MetricCard metricKey="precision" value={metrics.precision} color="amber" />
        <MetricCard metricKey="recall" value={metrics.recall} color="amber" />
        <MetricCard metricKey="f1" value={metrics.f1} color="amber" />
      </div>
      
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-1.5 pt-2.5 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            <AlertTriangle className="h-3.5 w-3.5" />
            Anomaly Scores
            {!hasScoreDistribution && <span className="ml-auto text-[9px] opacity-60 normal-case">Requires scoreDistribution</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-36 px-3 pb-3">
          {hasScoreDistribution ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.scoreDistribution} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(220, 15%, 15%)" vertical={false} />
                <XAxis dataKey="bin" stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="count" fill="#f59e0b" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataPlaceholder message="No anomaly score data" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DimensionalityReductionMetrics({ metrics }: { metrics: Record<string, number | any> }) {
  const hasVarianceData = Array.isArray(metrics.componentVariances) && metrics.componentVariances.length > 0;
  const varianceData = hasVarianceData 
    ? metrics.componentVariances.map((v: number, i: number) => ({ component: `PC${i + 1}`, variance: v }))
    : null;
  
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard metricKey="explainedVariance" value={metrics.explainedVariance ?? metrics.explained_variance} color="cyan" />
        <MetricCard metricKey="reconstructionError" value={metrics.reconstructionError ?? metrics.reconstruction_error} color="cyan" />
        <MetricCard metricKey="trustworthiness" value={metrics.trustworthiness} color="cyan" />
        <MetricCard metricKey="numComponents" value={metrics.numComponents ?? metrics.n_components} color="cyan" />
      </div>
      
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-1.5 pt-2.5 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            <Layers className="h-3.5 w-3.5" />
            Explained Variance
            {!varianceData && <span className="ml-auto text-[9px] opacity-60 normal-case">Requires componentVariances</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-36 px-3 pb-3">
          {varianceData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={varianceData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(220, 15%, 15%)" vertical={false} />
                <XAxis dataKey="component" stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(220, 10%, 40%)" fontSize={9} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="variance" fill="#06b6d4" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataPlaceholder message="No variance data" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SequenceMetrics({ metrics }: { metrics: Record<string, number | any> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard metricKey="mae" value={metrics.mae} color="green" />
        <MetricCard metricKey="rmse" value={metrics.rmse} color="green" />
        <MetricCard metricKey="mape" value={metrics.mape} color="green" />
        <MetricCard metricKey="directionalAccuracy" value={metrics.directionalAccuracy ?? metrics.finalAccuracy} color="green" />
      </div>
      
      <Card className="bg-black/20 border-white/10">
        <CardHeader className="pb-1.5 pt-2.5 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wider">
            <TrendingUp className="h-3.5 w-3.5" />
            Forecast vs Actual
            <span className="ml-auto text-[9px] opacity-60 normal-case">Requires forecastData</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="h-36 px-3 pb-3">
          <NoDataPlaceholder message="No forecast data available" />
        </CardContent>
      </Card>
    </div>
  );
}

export function CategoryMetrics({ subcategory, metrics, className }: CategoryMetricsProps) {
  if (!subcategory) return null;
  
  const subcategoryInfo = MODEL_SUBCATEGORIES[subcategory as keyof typeof MODEL_SUBCATEGORIES];
  if (!subcategoryInfo) return null;
  
  switch (subcategory) {
    case 'classification':
      return <ClassificationMetrics metrics={metrics} />;
    case 'regression':
      return <RegressionMetrics metrics={metrics} />;
    case 'clustering':
      return <ClusteringMetrics metrics={metrics} />;
    case 'anomaly-detection':
      return <AnomalyMetrics metrics={metrics} />;
    case 'dimensionality-reduction':
      return <DimensionalityReductionMetrics metrics={metrics} />;
    case 'sequence':
      return <SequenceMetrics metrics={metrics} />;
    default:
      return (
        <div className="text-center py-6 text-muted-foreground">
          <Database className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
          <p className="text-xs">Metrics for {subcategoryInfo?.name || subcategory} not implemented</p>
        </div>
      );
  }
}

export default CategoryMetrics;
