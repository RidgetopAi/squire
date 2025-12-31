'use client';

// ============================================
// SQUIRE WEB - VILLAGE BUILDING COMPONENT
// ============================================
// Renders a memory as a 3D building using GLTF models
// P3-T7: Performance optimizations with memoization and LOD

import React, { memo, useRef, useMemo, useCallback, Suspense, useState, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Group, Mesh } from 'three';
import type { VillageBuilding } from '@/lib/types/village';
import { BuildingModel } from './BuildingModel';

// ============================================
// LOD FALLBACK (simple box for distant views)
// ============================================

interface SimpleBuildingProps {
  scale: number;
  color: string;
}

/**
 * Simple box geometry for LOD - shown at distance for performance
 */
function SimpleBuilding({ scale, color }: SimpleBuildingProps) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[0.8 * scale, 1.2 * scale, 0.8 * scale]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

// Native THREE.LOD component - bypasses drei's Detailed which may have bugs
interface NativeLODProps {
  distances: number[];
  children: React.ReactNode;
}

function NativeLOD({ distances, children }: NativeLODProps) {
  const lodRef = useRef<THREE.LOD>(null);
  const { camera } = useThree();
  
  // Convert children to array
  const childArray = React.Children.toArray(children);
  
  useLayoutEffect(() => {
    const lod = lodRef.current;
    if (!lod) return;
    
    // Clear existing levels
    lod.levels.length = 0;
    
    // Add levels using THREE.LOD.addLevel which handles sorting
    lod.children.forEach((child, index) => {
      const distance = distances[index] ?? 0;
      // addLevel properly sorts by distance
      lod.addLevel(child, distance);
    });
  }, [distances, childArray.length]);
  
  // Update LOD each frame
  useFrame(() => {
    lodRef.current?.update(camera);
  });
  
  return (
    <lOD ref={lodRef}>
      {children}
    </lOD>
  );
}

// Debug component to show camera distance to LOD object
function DebugDistance({ show }: { show: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [distance, setDistance] = useState(0);

  useFrame(() => {
    if (!groupRef.current || !show) return;
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const lodPos = groupRef.current.getWorldPosition(new THREE.Vector3());
    setDistance(camPos.distanceTo(lodPos));
  });

  if (!show) return <group ref={groupRef} />;

  return (
    <group ref={groupRef}>
      <Html position={[0, 3, 0]} center style={{ pointerEvents: 'none' }}>
        <div style={{ 
          background: 'rgba(0,0,0,0.8)', 
          color: distance < 40 ? '#4ade80' : '#f87171',
          padding: '4px 8px', 
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap'
        }}>
          d={distance.toFixed(1)} {distance < 40 ? '(GLTF)' : '(BOX)'}
        </div>
      </Html>
    </group>
  );
}

// ============================================
// BUILDING COMPONENT
// ============================================

interface BuildingProps {
  building: VillageBuilding;
  /** Whether this building is selected */
  selected?: boolean;
  /** Whether this building is hovered */
  hovered?: boolean;
  /** Click handler */
  onClick?: (building: VillageBuilding) => void;
  /** Hover handlers */
  onPointerOver?: (building: VillageBuilding) => void;
  onPointerOut?: () => void;
  /** Show debug distance overlay */
  showDebug?: boolean;
}

/**
 * Building component - renders a memory as a 3D building using GLTF models
 * Scale varies based on salience (0.7 to 1.3x)
 *
 * Performance optimizations (P3-T7):
 * - Memoized with React.memo to prevent unnecessary re-renders
 * - LOD (Level of Detail): shows simple box at distance > 40 units
 * - Memoized computed values
 */
export const Building = memo(function Building({
  building,
  selected = false,
  hovered = false,
  onClick,
  onPointerOver,
  onPointerOut,
  showDebug = false,
}: BuildingProps) {
  const groupRef = useRef<Group>(null);

  // Validate position - skip rendering if invalid
  if (!Number.isFinite(building.position.x) || !Number.isFinite(building.position.z)) {
    console.warn('[Building] Invalid position:', building.id, building.position);
    return null;
  }

  // Memoize computed values
  const { baseScale, emissiveIntensity } = useMemo(() => {
    const salience = Number.isFinite(building.salience) ? building.salience : 0.5;
    return {
      baseScale: 0.7 + salience * 0.6, // 0.7 to 1.3
      emissiveIntensity: selected ? 0.4 : hovered ? 0.2 : 0,
    };
  }, [building.salience, selected, hovered]);

  // Base Y position for hover animation
  const baseY = 0;

  // Animate hover effect (lift building slightly)
  useFrame((_, delta) => {
    if (groupRef.current) {
      const targetY = hovered || selected ? baseY + 0.15 : baseY;
      groupRef.current.position.y += (targetY - groupRef.current.position.y) * delta * 8;
    }
  });

  // Memoize event handlers
  const handlePointerOver = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    onPointerOver?.(building);
  }, [building, onPointerOver]);

  const handlePointerOut = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.body.style.cursor = 'auto';
    onPointerOut?.();
  }, [onPointerOut]);

  const handleClick = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onClick?.(building);
  }, [building, onClick]);

  return (
    <group
      position={[building.position.x, 0, building.position.z]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      {/* Debug distance display */}
      <DebugDistance show={showDebug} />
      
      {/* Animated wrapper for hover lift */}
      <group ref={groupRef} position={[0, baseY, 0]}>
        {/* Suspense wraps the LOD - NativeLOD bypasses drei's buggy Detailed */}
        <Suspense fallback={<SimpleBuilding scale={baseScale} color={building.color} />}>
          {/* LOD: child[0] at distance 0 (near), child[1] at distance 40 (far) */}
          <NativeLOD distances={[0, 40]}>
            {/* Near: Full GLTF model (shown when camera < 40 units) */}
            <BuildingModel
              buildingType={building.buildingType}
              scale={baseScale}
              emissiveIntensity={emissiveIntensity}
              emissiveColor={building.color}
              castShadow
              receiveShadow
            />
            {/* Far: Simple box geometry (shown when camera >= 40 units) */}
            <SimpleBuilding scale={baseScale} color={building.color} />
          </NativeLOD>
        </Suspense>
      </group>
    </group>
  );
});

// ============================================
// BUILDINGS LAYER COMPONENT
// ============================================

interface BuildingsLayerProps {
  buildings: VillageBuilding[];
  /** ID of currently selected building */
  selectedBuildingId?: string | null;
  /** ID of currently hovered building */
  hoveredBuildingId?: string | null;
  /** Click handler */
  onBuildingClick?: (building: VillageBuilding) => void;
  /** Hover handlers */
  onBuildingHover?: (building: VillageBuilding | null) => void;
}

/**
 * Renders all buildings in the village
 * Memoized to prevent re-renders when parent updates
 */
export const BuildingsLayer = memo(function BuildingsLayer({
  buildings,
  selectedBuildingId,
  hoveredBuildingId,
  onBuildingClick,
  onBuildingHover,
}: BuildingsLayerProps) {
  // Memoize hover callbacks to prevent Building re-renders
  const handlePointerOver = useCallback((b: VillageBuilding) => {
    onBuildingHover?.(b);
  }, [onBuildingHover]);

  const handlePointerOut = useCallback(() => {
    onBuildingHover?.(null);
  }, [onBuildingHover]);

  return (
    <group name="buildings">
      {buildings.map((building, index) => (
        <Building
          key={building.id}
          building={building}
          selected={building.id === selectedBuildingId}
          hovered={building.id === hoveredBuildingId}
          onClick={onBuildingClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          showDebug={index < 3} // Debug first 3 buildings
        />
      ))}
    </group>
  );
});

export default Building;
