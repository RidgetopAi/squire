'use client';

import { Suspense, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { VillageCanvas } from './VillageCanvas';
import { MemoryPanel } from './MemoryPanel';
import type { VillageBuilding } from '@/lib/types/village';

export default function VillageScene() {
  // Selection state
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<VillageBuilding | null>(null);

  // Hover state for tooltip
  const [hoveredBuilding, setHoveredBuilding] = useState<VillageBuilding | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const handleBuildingSelect = useCallback((building: VillageBuilding | null) => {
    setSelectedBuilding(building);
    setSelectedMemoryId(building?.memoryId ?? null);
  }, []);

  const handleBuildingHover = useCallback((building: VillageBuilding | null) => {
    setHoveredBuilding(building);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedMemoryId(null);
    setSelectedBuilding(null);
  }, []);

  return (
    <div className="relative h-full w-full bg-background" onMouseMove={handleMouseMove}>
      <Canvas
        shadows
        frameloop="demand"
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a0a0f');
        }}
      >
        <Suspense fallback={null}>
          <VillageCanvas
            onBuildingSelect={handleBuildingSelect}
            onBuildingHover={handleBuildingHover}
          />
        </Suspense>
      </Canvas>

      {/* Overlay UI */}
      <div className="pointer-events-none absolute inset-0">
        {/* Top left - Title */}
        <div className="absolute left-4 top-4">
          <h1 className="text-lg font-semibold text-foreground">Memory Village</h1>
          <p className="text-sm text-foreground-muted">Click a building to view memory</p>
        </div>

        {/* Bottom left - Controls hint */}
        <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-background/80 px-3 py-2 backdrop-blur-sm">
          <p className="text-xs text-foreground-muted">
            <span className="font-medium text-foreground">Mouse:</span> Drag to rotate, Scroll to zoom
          </p>
          <p className="text-xs text-foreground-muted">
            <span className="font-medium text-foreground">Touch:</span> Drag to rotate, Pinch to zoom
          </p>
        </div>

        {/* Hover Tooltip */}
        {hoveredBuilding && !selectedBuilding && (
          <div
            className="pointer-events-none fixed z-50 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm"
            style={{
              left: mousePosition.x + 16,
              top: mousePosition.y + 16,
              maxWidth: 280,
            }}
          >
            <p className="text-sm font-medium text-foreground truncate">
              {hoveredBuilding.label}
            </p>
            <p className="text-xs text-foreground-muted capitalize">
              {hoveredBuilding.category} • {hoveredBuilding.buildingType}
            </p>
          </div>
        )}
      </div>

      {/* Memory Panel Overlay */}
      <MemoryPanel
        memoryId={selectedMemoryId}
        building={selectedBuilding}
        onClose={handleClosePanel}
      />
    </div>
  );
}
