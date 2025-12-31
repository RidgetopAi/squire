'use client';

// ============================================
// SQUIRE WEB - VILLAGE CANVAS
// ============================================
// Main 3D scene content for Memory Village

import { useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useVillageLayout, useVillageSelection } from '@/lib/hooks/useVillageLayout';
import { BuildingsLayer } from './Building';
import { RoadsLayer } from './Road';
import { VillageGround } from './DistrictGround';
import type { VillageBuilding, VillageLayout } from '@/lib/types/village';

// ============================================
// SIMPLE GROUND (for loading/empty states)
// ============================================

function SimpleGround() {
  return (
    <>
      {/* Simple dark ground plane for loading/empty states */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[30, 32]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>
      {/* Shadow receiver */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </>
  );
}

// ============================================
// LIGHTING
// ============================================

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[15, 20, 15]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={80}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      {/* Fill light from opposite side */}
      <directionalLight
        position={[-10, 8, -10]}
        intensity={0.3}
      />
      {/* Slight color tint for atmosphere */}
      <hemisphereLight
        color="#7c3aed"
        groundColor="#1e1b4b"
        intensity={0.15}
      />
    </>
  );
}

// ============================================
// CAMERA RIG
// ============================================

interface CameraRigProps {
  bounds: VillageLayout['bounds'];
}

function CameraRig({ bounds }: CameraRigProps) {
  const { invalidate } = useThree();

  // Calculate camera position based on layout bounds
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeZ = bounds.maxZ - bounds.minZ;
  const maxRange = Math.max(rangeX, rangeZ, 20);

  // Position camera to see entire village
  const cameraDistance = maxRange * 0.8;

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={[centerX + cameraDistance, cameraDistance * 0.7, centerZ + cameraDistance]}
        fov={50}
        near={0.1}
        far={500}
      />
      <OrbitControls
        target={[centerX, 0, centerZ]}
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={100}
        maxPolarAngle={Math.PI / 2.1}
        minPolarAngle={0.2}
        onChange={() => invalidate()}
      />
    </>
  );
}

// ============================================
// EMPTY STATE
// ============================================

function EmptyState() {
  return (
    <group>
      {/* Show a simple indicator that village is empty */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#475569"
          opacity={0.5}
          transparent
        />
      </mesh>
    </group>
  );
}

// ============================================
// LOADING STATE (3D)
// ============================================

function LoadingState() {
  return (
    <group>
      {/* Animated loading indicator */}
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial
          color="#a78bfa"
          emissive="#a78bfa"
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  );
}

// ============================================
// VILLAGE CONTENT
// ============================================

interface VillageContentProps {
  layout: VillageLayout;
  selectedBuildingId: string | null;
  hoveredBuildingId: string | null;
  onBuildingClick: (building: VillageBuilding) => void;
  onBuildingHover: (building: VillageBuilding | null) => void;
}

function VillageContent({
  layout,
  selectedBuildingId,
  hoveredBuildingId,
  onBuildingClick,
  onBuildingHover,
}: VillageContentProps) {
  return (
    <>
      <CameraRig bounds={layout.bounds} />
      <Lighting />

      {/* District hex tile ground */}
      <VillageGround layout={layout} />

      {/* Roads (render first so buildings appear on top) */}
      <RoadsLayer
        roads={layout.roads}
        selectedBuildingId={selectedBuildingId}
      />

      {/* Buildings */}
      <BuildingsLayer
        buildings={layout.buildings}
        selectedBuildingId={selectedBuildingId}
        hoveredBuildingId={hoveredBuildingId}
        onBuildingClick={onBuildingClick}
        onBuildingHover={onBuildingHover}
      />
    </>
  );
}

// ============================================
// MAIN CANVAS COMPONENT
// ============================================

export interface VillageCanvasProps {
  /** Callback when a building is selected */
  onBuildingSelect?: (memoryId: string | null) => void;
}

/**
 * Main village canvas content
 * Fetches graph data and renders the village layout
 */
export function VillageCanvas({ onBuildingSelect }: VillageCanvasProps) {
  // Fetch layout data
  const { layout, isLoading, isError, isEmpty } = useVillageLayout({
    maxBuildings: 120,
    minSalience: 0,
  });

  console.log('[VillageCanvas] State:', { isLoading, isError, isEmpty, buildings: layout.buildings.length });

  // Selection state
  const {
    selection,
    selectBuilding,
    hoverBuilding,
  } = useVillageSelection();

  // Handle building click
  const handleBuildingClick = useCallback((building: VillageBuilding) => {
    const isAlreadySelected = selection.buildingId === building.id;
    const newBuildingId = isAlreadySelected ? null : building.id;
    const newMemoryId = isAlreadySelected ? null : building.memoryId;

    selectBuilding(newBuildingId, newMemoryId);
    onBuildingSelect?.(newMemoryId);
  }, [selection.buildingId, selectBuilding, onBuildingSelect]);

  // Handle building hover
  const handleBuildingHover = useCallback((building: VillageBuilding | null) => {
    hoverBuilding(building?.id ?? null);
  }, [hoverBuilding]);

  // Default camera for loading/empty states
  const defaultBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

  // Loading state
  if (isLoading) {
    return (
      <>
        <CameraRig bounds={defaultBounds} />
        <Lighting />
        <SimpleGround />
        <LoadingState />
      </>
    );
  }

  // Error state
  if (isError) {
    return (
      <>
        <CameraRig bounds={defaultBounds} />
        <Lighting />
        <SimpleGround />
        <EmptyState />
      </>
    );
  }

  // Empty state
  if (isEmpty) {
    return (
      <>
        <CameraRig bounds={defaultBounds} />
        <Lighting />
        <SimpleGround />
        <EmptyState />
      </>
    );
  }

  // Main content
  return (
    <VillageContent
      layout={layout}
      selectedBuildingId={selection.buildingId}
      hoveredBuildingId={selection.hoveredBuildingId}
      onBuildingClick={handleBuildingClick}
      onBuildingHover={handleBuildingHover}
    />
  );
}

export default VillageCanvas;
