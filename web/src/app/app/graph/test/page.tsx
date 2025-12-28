'use client';

/**
 * MINIMAL GRAPH TEST PAGE
 * Purpose: Isolate the rendering bug by stripping features one by one
 * 
 * Test progression:
 * 1. Bare minimum - just nodes/links, no callbacks
 * 2. Add onEngineStop with zoomToFit
 * 3. Add onNodeHover (state update)
 * 4. Add nodeCanvasObject (custom rendering)
 * 5. Add linkLineDash (callback with state dependency)
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphMethods = any;

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => <div className="p-8 text-center">Loading graph...</div>,
});

// Simple test data
const TEST_DATA = {
  nodes: [
    { id: 'memory1', label: 'Memory 1', type: 'memory', val: 4, color: '#60a5fa' },
    { id: 'memory2', label: 'Memory 2', type: 'memory', val: 4, color: '#60a5fa' },
    { id: 'memory3', label: 'Memory 3', type: 'memory', val: 4, color: '#60a5fa' },
    { id: 'entity1', label: 'Entity 1', type: 'entity', val: 8, color: '#a78bfa' },
    { id: 'entity2', label: 'Entity 2', type: 'entity', val: 8, color: '#a78bfa' },
  ],
  links: [
    { source: 'entity1', target: 'memory1', color: '#8b5cf6' },
    { source: 'entity1', target: 'memory2', color: '#8b5cf6' },
    { source: 'entity2', target: 'memory2', color: '#8b5cf6' },
    { source: 'entity2', target: 'memory3', color: '#8b5cf6' },
    { source: 'memory1', target: 'memory2', color: '#3b82f6' },
  ],
};

type TestLevel = 1 | 2 | 3 | 4 | 5;

export default function GraphTestPage() {
  const graphRef = useRef<ForceGraphMethods>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitialZoomRef = useRef(false);
  
  const [testLevel, setTestLevel] = useState<TestLevel>(1);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoverCount, setHoverCount] = useState(0);
  const [zoomFitCount, setZoomFitCount] = useState(0);

  // Handle container resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Reset zoom ref when test level changes
  useEffect(() => {
    hasInitialZoomRef.current = false;
    setHoverCount(0);
    setZoomFitCount(0);
  }, [testLevel]);

  // MEMOIZE graphData so it doesn't recreate on every render
  const graphData = useMemo(() => ({
    nodes: TEST_DATA.nodes.map(n => ({ ...n })),
    links: TEST_DATA.links.map(l => ({ ...l })),
  }), []); // Empty deps = only create once

  const testDescriptions: Record<TestLevel, string> = {
    1: 'Bare minimum - no callbacks at all',
    2: 'Add onEngineStop with zoomToFit (once via ref)',
    3: 'Add onNodeHover (updates React state)',
    4: 'Add nodeCanvasObject (custom canvas rendering)',
    5: 'Add linkLineDash (callback depending on hover state)',
  };

  // Build props based on test level
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getGraphProps = (): Record<string, any> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: Record<string, any> = {
      ref: graphRef,
      width: dimensions.width,
      height: dimensions.height,
      graphData: graphData,
      nodeId: 'id',
      nodeLabel: 'label',
      nodeVal: 'val',
      nodeColor: 'color',
      linkSource: 'source',
      linkTarget: 'target',
      linkColor: 'color',
      backgroundColor: 'transparent',
      cooldownTicks: 100,
    };

    if (testLevel >= 2) {
      props.onEngineStop = () => {
        if (!hasInitialZoomRef.current) {
          hasInitialZoomRef.current = true;
          setZoomFitCount(c => c + 1);
          graphRef.current?.zoomToFit(400, 50);
        }
      };
    }

    if (testLevel >= 3) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props.onNodeHover = (node: any) => {
        setHoveredNode(node?.id || null);
        setHoverCount(c => c + 1);
      };
    }

    if (testLevel >= 4) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props.nodeCanvasObject = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const label = node.label || '';
        const fontSize = 12 / globalScale;
        const nodeSize = (node.val || 4) / globalScale * 2;

        // Draw node circle
        ctx.beginPath();
        ctx.arc(node.x || 0, node.y || 0, nodeSize, 0, 2 * Math.PI);
        ctx.fillStyle = node.color || '#64748b';
        ctx.fill();

        // Highlight if hovered (THIS IS THE KEY - depends on hoveredNode state)
        if (hoveredNode === node.id) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / globalScale;
          ctx.stroke();
        }

        // Draw label
        if (globalScale > 0.5) {
          ctx.font = `${fontSize}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(label, node.x || 0, (node.y || 0) + nodeSize + fontSize);
        }
      };
    }

    if (testLevel >= 5) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props.linkLineDash = (link: any) => {
        // This depends on hoveredNode state
        if (!hoveredNode) return [];
        const isConnected = link.source?.id === hoveredNode || link.target?.id === hoveredNode ||
                           link.source === hoveredNode || link.target === hoveredNode;
        return isConnected ? [] : [2, 2];
      };
    }

    return props;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-border bg-surface-raised">
        <h1 className="text-xl font-semibold text-foreground mb-2">
          🧪 Graph Rendering Bug Test
        </h1>
        <p className="text-sm text-foreground-muted">
          Test Level {testLevel}: {testDescriptions[testLevel]}
        </p>
      </div>

      {/* Controls */}
      <div className="flex-none px-6 py-3 border-b border-border bg-surface-sunken flex items-center gap-4">
        <span className="text-sm text-foreground-muted">Test Level:</span>
        {([1, 2, 3, 4, 5] as TestLevel[]).map(level => (
          <button
            key={level}
            onClick={() => setTestLevel(level)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              testLevel === level
                ? 'bg-primary text-white'
                : 'bg-surface-raised border border-border hover:bg-surface-sunken text-foreground-muted'
            }`}
          >
            {level}
          </button>
        ))}
        
        <div className="ml-auto flex items-center gap-4 text-xs text-foreground-muted">
          <span>Hovers: {hoverCount}</span>
          <span>ZoomFits: {zoomFitCount}</span>
          <span>Hovered: {hoveredNode || 'none'}</span>
        </div>
      </div>

      {/* Graph */}
      <div ref={containerRef} className="flex-1 bg-surface-sunken">
        <ForceGraph2D {...getGraphProps()} />
      </div>

      {/* Instructions */}
      <div className="flex-none px-6 py-3 border-t border-border bg-surface-raised text-sm text-foreground-muted">
        <strong>Instructions:</strong> Start at Level 1 and hover over nodes. If no bug, move to Level 2, etc. 
        The bug should appear at some level, identifying the problematic feature.
      </div>
    </div>
  );
}
