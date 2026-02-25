import { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';

interface ClusterNode {
  id: string;
  cluster: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface ClusterLink {
  source: string | ClusterNode;
  target: string | ClusterNode;
  strength: number;
}

interface ForceDirectedClusterProps {
  data: {
    nodes: { id: string; cluster: number; features?: number[] }[];
    links?: { source: string; target: string; strength?: number }[];
  } | null;
  width?: number;
  height?: number;
  animated?: boolean;
  showLabels?: boolean;
}

const CLUSTER_COLORS = [
  '#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', 
  '#ef4444', '#ec4899', '#3b82f6', '#84cc16',
  '#a855f7', '#14b8a6', '#eab308', '#10b981'
];

export function ForceDirectedCluster({ 
  data, 
  width = 400, 
  height = 300,
  animated = true,
  showLabels = false
}: ForceDirectedClusterProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<ClusterNode, ClusterLink> | null>(null);

  const processedData = useMemo(() => {
    if (!data?.nodes || data.nodes.length === 0) return null;

    const nodes: ClusterNode[] = data.nodes.map(n => ({
      id: n.id,
      cluster: n.cluster,
    }));

    const links: ClusterLink[] = data.links?.map(l => ({
      source: l.source,
      target: l.target,
      strength: l.strength ?? 0.5,
    })) || [];

    if (links.length === 0) {
      const clusterGroups = new Map<number, string[]>();
      nodes.forEach(n => {
        if (!clusterGroups.has(n.cluster)) {
          clusterGroups.set(n.cluster, []);
        }
        clusterGroups.get(n.cluster)!.push(n.id);
      });

      clusterGroups.forEach((nodeIds) => {
        for (let i = 0; i < nodeIds.length; i++) {
          for (let j = i + 1; j < nodeIds.length && j < i + 3; j++) {
            links.push({
              source: nodeIds[i]!,
              target: nodeIds[j]!,
              strength: 0.8,
            });
          }
        }
      });
    }

    return { nodes, links };
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || !processedData) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { nodes, links } = processedData;
    const centerX = width / 2;
    const centerY = height / 2;

    const uniqueClusters = Array.from(new Set(nodes.map(n => n.cluster))).sort((a, b) => a - b);
    const clusterCenters = new Map<number, { x: number; y: number }>();
    const angleStep = (2 * Math.PI) / uniqueClusters.length;
    const clusterRadius = Math.min(width, height) * 0.25;

    uniqueClusters.forEach((cluster, i) => {
      clusterCenters.set(cluster, {
        x: centerX + clusterRadius * Math.cos(i * angleStep - Math.PI / 2),
        y: centerY + clusterRadius * Math.sin(i * angleStep - Math.PI / 2),
      });
    });

    nodes.forEach(node => {
      const center = clusterCenters.get(node.cluster) || { x: centerX, y: centerY };
      node.x = center.x + (Math.random() - 0.5) * 50;
      node.y = center.y + (Math.random() - 0.5) * 50;
    });

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const linkElements = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', 'rgba(255,255,255,0.1)')
      .attr('stroke-width', 0.5);

    const nodeElements = g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('r', 5)
      .attr('fill', d => CLUSTER_COLORS[d.cluster % CLUSTER_COLORS.length] ?? '#888')
      .attr('stroke', 'rgba(255,255,255,0.3)')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.8);

    if (showLabels) {
      g.append('g')
        .attr('class', 'labels')
        .selectAll('text')
        .data(nodes)
        .enter()
        .append('text')
        .text(d => d.id)
        .attr('font-size', 8)
        .attr('fill', 'rgba(255,255,255,0.6)')
        .attr('dx', 8)
        .attr('dy', 3);
    }

    const clusterForce = (alpha: number) => {
      nodes.forEach(node => {
        const center = clusterCenters.get(node.cluster);
        if (center && node.x !== undefined && node.y !== undefined) {
          node.vx = (node.vx || 0) + (center.x - node.x) * alpha * 0.1;
          node.vy = (node.vy || 0) + (center.y - node.y) * alpha * 0.1;
        }
      });
    };

    const simulation = d3.forceSimulation<ClusterNode>(nodes)
      .force('link', d3.forceLink<ClusterNode, ClusterLink>(links)
        .id(d => d.id)
        .strength(d => d.strength * 0.5)
        .distance(30))
      .force('charge', d3.forceManyBody().strength(-30))
      .force('center', d3.forceCenter(centerX, centerY).strength(0.05))
      .force('collision', d3.forceCollide().radius(8))
      .force('cluster', clusterForce)
      .alphaDecay(animated ? 0.02 : 1);

    simulationRef.current = simulation;

    simulation.on('tick', () => {
      linkElements
        .attr('x1', d => (d.source as ClusterNode).x || 0)
        .attr('y1', d => (d.source as ClusterNode).y || 0)
        .attr('x2', d => (d.target as ClusterNode).x || 0)
        .attr('y2', d => (d.target as ClusterNode).y || 0);

      nodeElements
        .attr('cx', d => d.x || 0)
        .attr('cy', d => d.y || 0);

      if (showLabels) {
        g.selectAll('.labels text')
          .attr('x', (d: any) => d.x || 0)
          .attr('y', (d: any) => d.y || 0);
      }
    });

    const drag = d3.drag<SVGCircleElement, ClusterNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeElements.call(drag);

    const legend = svg.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(10, 10)`);

    uniqueClusters.slice(0, 6).forEach((cluster, i) => {
      const legendItem = legend.append('g')
        .attr('transform', `translate(0, ${i * 14})`);

      legendItem.append('circle')
        .attr('r', 4)
        .attr('cx', 4)
        .attr('cy', 0)
        .attr('fill', CLUSTER_COLORS[cluster % CLUSTER_COLORS.length] ?? '#888');

      legendItem.append('text')
        .attr('x', 12)
        .attr('y', 3)
        .attr('font-size', 9)
        .attr('fill', 'rgba(255,255,255,0.7)')
        .text(`C${cluster + 1}`);
    });

    return () => {
      simulation.stop();
    };
  }, [processedData, width, height, animated, showLabels]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="5" cy="12" r="3" />
            <circle cx="19" cy="5" r="3" />
            <circle cx="19" cy="19" r="3" />
            <path d="M8 12h5m3-5v8" />
          </svg>
          <p className="text-xs">No cluster data</p>
          <p className="text-[10px] opacity-60">Requires nodes with cluster assignments</p>
        </div>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="bg-black/20 rounded"
      style={{ minHeight: height }}
    />
  );
}

export default ForceDirectedCluster;
