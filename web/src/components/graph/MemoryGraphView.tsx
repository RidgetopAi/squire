'use client';

// ============================================
// MEMORY GRAPH VIEW COMPONENT
// ============================================
// Displays a graph visualization centered on a memory
// Shows the memory's connected entities and similar memories

import { useRef, useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useMemorySubgraph } from '@/lib/hooks/useGraphData';
import type { ForceGraphNode, ForceGraphLink } from '@/lib/api/graph';

// Graph node with position data (added by force simulation)
interface GraphNodeWithPosition extends ForceGraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphMethods = any;

// Dynamically import ForceGraph2D to avoid SSR issues
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-foreground-muted text-sm">Loading graph...</div>
    </div>
  ),
});

// Entity type colors
const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: '#a78bfa',      // violet-400
  organization: '#60a5fa', // blue-400
  location: '#34d399',     // emerald-400
  project: '#f472b6',      // pink-400
  concept: '#facc15',      // yellow-400
  event: '#fb923c',        // orange-400
};

// ============================================
// COMPONENT PROPS
// ============================================

export interface MemoryGraphViewProps {
  /** The memory ID to center the graph on */
  memoryId: string;
  /** Maximum number of hops from the center memory (default: 1) */
  maxHops?: number;
  /** Whether to include connected entities (default: true) */
  includeEntities?: boolean;
  /** Display size variant */
  variant?: 'compact' | 'default' | 'full';
  /** Optional className for the container */
  className?: string;
  /** Callback when a node is clicked */
  onNodeClick?: (node: ForceGraphNode) => void;
  /** Callback when an entity is clicked */
  onEntityClick?: (entityId: string, entityName: string) => void;
  /** Callback when a memory is clicked */
  onMemoryClick?: (memoryId: string) => void;
  /** Whether to show the legend */
  showLegend?: boolean;
  /** Whether to show zoom controls */
  showControls?: boolean;
  /** Background style */
  background?: 'transparent' | 'subtle';
}

// ============================================
// COMPONENT
// ============================================

export function MemoryGraphView({
  memoryId,
  maxHops = 1,
  includeEntities = true,
  variant = 'default',
  className = '',
  onNodeClick,
  onEntityClick,
  onMemoryClick,
  showLegend = false,
  showControls = true,
  background = 'transparent',
}: MemoryGraphViewProps) {
  const graphRef = useRef<ForceGraphMethods>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 });
  const [hoveredNode, setHoveredNode] = useState<GraphNodeWithPosition | null>(null);

  // Fetch memory subgraph
  const { data: graphData, isLoading, error } = useMemorySubgraph(memoryId, {
    maxHops,
    includeEntities,
  });

  // Calculate dimensions based on variant
  const getVariantHeight = () => {
    switch (variant) {
      case 'compact':
        return 200;
      case 'full':
        return 500;
      default:
        return 300;
    }
  };

  // Handle container resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: Math.max(rect.height, getVariantHeight()),
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [variant]);

  // Node click handler
  const handleNodeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any) => {
      const forceNode = node as ForceGraphNode;

      // Call generic callback
      onNodeClick?.(forceNode);

      // Call type-specific callbacks
      if (forceNode.type === 'entity') {
        onEntityClick?.(forceNode.id, forceNode.label);
      } else if (forceNode.type === 'memory') {
        onMemoryClick?.(forceNode.id);
      }
    },
    [onNodeClick, onEntityClick, onMemoryClick]
  );

  // Node hover handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node as GraphNodeWithPosition | null);
  }, []);

  // Custom node rendering
  const nodeCanvasObject = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = node.label || '';
      const fontSize = variant === 'compact' ? 10 / globalScale : 12 / globalScale;
      const nodeSize = (node.val || 4) / globalScale * 2;

      // Check if this is the center memory
      const isCenterMemory = node.type === 'memory' && node.id === memoryId;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x || 0, node.y || 0, nodeSize, 0, 2 * Math.PI);

      // Center memory gets special highlight
      if (isCenterMemory) {
        ctx.fillStyle = '#22d3ee'; // cyan-400
      } else if (node.type === 'entity') {
        const entityType = node.attributes?.type as string;
        ctx.fillStyle = ENTITY_TYPE_COLORS[entityType] || node.color || '#a78bfa';
      } else {
        ctx.fillStyle = node.color || '#64748b';
      }
      ctx.fill();

      // Draw border if hovered or center
      if (hoveredNode?.id === node.id || isCenterMemory) {
        ctx.strokeStyle = isCenterMemory ? '#22d3ee' : '#fff';
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Draw label (skip for compact variant at low zoom)
      const minScaleForLabels = variant === 'compact' ? 0.8 : 0.5;
      if (globalScale > minScaleForLabels) {
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e2e8f0';
        const maxChars = variant === 'compact' ? 15 : 20;
        ctx.fillText(
          label.slice(0, maxChars) + (label.length > maxChars ? '...' : ''),
          node.x || 0,
          (node.y || 0) + nodeSize + fontSize
        );
      }
    },
    [hoveredNode, memoryId, variant]
  );

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    graphRef.current?.zoom(1.5, 400);
  }, []);

  const handleZoomOut = useCallback(() => {
    graphRef.current?.zoom(0.67, 400);
  }, []);

  const handleCenter = useCallback(() => {
    graphRef.current?.centerAt(0, 0, 400);
    graphRef.current?.zoom(1, 400);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ minHeight: getVariantHeight() }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-foreground-muted">Loading graph...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={`flex items-center justify-center text-center p-4 ${className}`}
        style={{ minHeight: getVariantHeight() }}
      >
        <div>
          <p className="text-sm text-red-400">Failed to load graph</p>
          <p className="text-xs text-foreground-muted mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-center p-4 ${className}`}
        style={{ minHeight: getVariantHeight() }}
      >
        <div>
          <p className="text-sm text-foreground-muted">No connections found</p>
          <p className="text-xs text-foreground-muted mt-1">
            This memory has no linked entities or similar memories.
          </p>
        </div>
      </div>
    );
  }

  const bgClass = background === 'subtle' ? 'bg-surface-sunken/50' : '';

  return (
    <div
      ref={containerRef}
      className={`relative ${bgClass} ${className}`}
      style={{ minHeight: getVariantHeight() }}
    >
      {/* Zoom Controls */}
      {showControls && (
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded bg-surface-raised/80 border border-border/50 hover:bg-surface-sunken transition-colors"
            title="Zoom in"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded bg-surface-raised/80 border border-border/50 hover:bg-surface-sunken transition-colors"
            title="Zoom out"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </button>
          <button
            onClick={handleCenter}
            className="p-1.5 rounded bg-surface-raised/80 border border-border/50 hover:bg-surface-sunken transition-colors"
            title="Center view"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Hovered Node Tooltip */}
      {hoveredNode && variant !== 'compact' && (
        <div className="absolute bottom-2 left-2 z-10 p-2 rounded bg-surface-raised/90 border border-border/50 shadow-lg max-w-[200px]">
          <div className="text-xs font-medium text-foreground truncate">{hoveredNode.label}</div>
          <div className="text-[10px] text-foreground-muted mt-0.5 capitalize">
            {hoveredNode.type}
            {hoveredNode.type === 'entity' && hoveredNode.attributes?.type
              ? ` • ${String(hoveredNode.attributes.type)}`
              : null}
          </div>
        </div>
      )}

      {/* Graph */}
      <ForceGraph2D
        key={memoryId}
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={{
          nodes: graphData.nodes.map((n) => ({ ...n })),
          links: graphData.links.map((l) => ({ ...l })),
        }}
        nodeId="id"
        nodeLabel="label"
        nodeVal="val"
        nodeColor="color"
        linkSource="source"
        linkTarget="target"
        linkColor="color"
        linkWidth={(link: unknown) => Math.max(0.5, ((link as { weight?: number }).weight || 0.5) * 2)}
        linkDirectionalParticles={variant === 'compact' ? 0 : 1}
        linkDirectionalParticleWidth={1.5}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        nodeCanvasObject={nodeCanvasObject}
        backgroundColor="transparent"
        cooldownTicks={variant === 'compact' ? 50 : 80}
        d3VelocityDecay={0.4}
        onEngineStop={() => graphRef.current?.zoomToFit(300, 30)}
      />

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-2 right-2 z-10 p-2 rounded bg-surface-raised/80 border border-border/50 text-[10px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-foreground-muted">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>This Memory</span>
            </div>
            <div className="flex items-center gap-1.5 text-foreground-muted">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span>Similar Memory</span>
            </div>
            <div className="flex items-center gap-1.5 text-foreground-muted">
              <span className="w-2 h-2 rounded-full bg-violet-400" />
              <span>Entity</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemoryGraphView;
