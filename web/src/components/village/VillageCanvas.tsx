'use client';

// ============================================
// SQUIRE WEB - VILLAGE CANVAS
// ============================================
// Main 3D scene content for Memory Village

import { useCallback } from 'react';
// useThree removed - using frameloop="always" now
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useVillageLayout, useVillageSelection } from '@/lib/hooks/useVillageLayout';
import { BuildingsLayer } from './Building';
import { LightBeamsLayer } from './LightBeamRoad';
import { VillageGround } from './DistrictGround';
import { DISTRICT_EDGE_COLORS } from './HexTile';
import { PropsLayer } from './InstancedProps';
import { VillagersLayer } from './Villager';
import { preloadAllBuildingModels, preloadAllPropModels } from '@/lib/village/models';
import type { VillageBuilding, VillageLayout, VillageDistrict, VillageProp, VillageVillager } from '@/lib/types/village';

// Preload all GLTF models at module load time
// This starts fetching models before the scene renders
preloadAllBuildingModels();
preloadAllPropModels();

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
// ATMOSPHERE (FOG)
// ============================================

/**
 * Atmospheric fog for depth perception
 * Uses linear fog with dark purple color matching the scene
 */
function Atmosphere() {
  return (
    <fog attach="fog" args={['#1a1525', 30, 120]} />
  );
}

// ============================================
// LIGHTING
// ============================================

function Lighting() {
  return (
    <>
      {/* Ambient base - slightly warm */}
      <ambientLight intensity={0.25} color="#ffe4c4" />

      {/* Main sun light - golden hour angle from southwest */}
      <directionalLight
        position={[-20, 25, -15]}
        intensity={1.4}
        color="#ffeedd"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={100}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0001}
        shadow-radius={2}
      />

      {/* Cool fill light from opposite side (simulates sky bounce) */}
      <directionalLight
        position={[15, 12, 20]}
        intensity={0.25}
        color="#b4d4ff"
      />

      {/* Rim light from behind for depth */}
      <directionalLight
        position={[0, 8, -25]}
        intensity={0.15}
        color="#ffd4a8"
      />

      {/* Hemisphere light - purple sky, warm ground for fantasy feel */}
      <hemisphereLight
        color="#8b5cf6"
        groundColor="#2d1f47"
        intensity={0.35}
      />

      {/* Subtle point light at world center for warmth */}
      <pointLight
        position={[0, 6, 0]}
        intensity={0.3}
        color="#ffa500"
        distance={30}
        decay={2}
      />
    </>
  );
}

// ============================================
// DISTRICT ACCENT LIGHTS
// ============================================

interface DistrictLightsProps {
  districts: VillageDistrict[];
}

/**
 * Colored point lights at each district center
 * Creates localized atmosphere matching district theme
 */
function DistrictLights({ districts }: DistrictLightsProps) {
  return (
    <group>
      {districts.map((district) => {
        const color = DISTRICT_EDGE_COLORS[district.category];
        return (
          <pointLight
            key={`district-light-${district.category}`}
            position={[district.center.x, 4, district.center.z]}
            intensity={0.4}
            color={color}
            distance={15}
            decay={2}
          />
        );
      })}
    </group>
  );
}

// ============================================
// CAMERA RIG
// ============================================

interface CameraRigProps {
  bounds: VillageLayout['bounds'];
}

function CameraRig({ bounds }: CameraRigProps) {
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
        zoomSpeed={0.3}
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
  props: VillageProp[];
  villagers: VillageVillager[];
  selectedBuildingId: string | null;
  hoveredBuildingId: string | null;
  onBuildingClick: (building: VillageBuilding) => void;
  onBuildingHover: (building: VillageBuilding | null) => void;
}

function VillageContent({
  layout,
  props,
  villagers,
  selectedBuildingId,
  hoveredBuildingId,
  onBuildingClick,
  onBuildingHover,
}: VillageContentProps) {
  return (
    <>
      <CameraRig bounds={layout.bounds} />
      <Atmosphere />
      <Lighting />

      {/* District accent lights */}
      <DistrictLights districts={layout.districts} />

      {/* District hex tile ground */}
      <VillageGround layout={layout} />

      {/* Light beam roads (curved, animated, only show for selected building) */}
      <LightBeamsLayer
        roads={layout.roads}
        selectedBuildingId={selectedBuildingId}
      />

      {/* Props (barrels, trees, rocks - between roads and buildings) */}
      <PropsLayer props={props} />

      {/* Villagers (entities as characters) */}
      <VillagersLayer villagers={villagers} />

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
  onBuildingSelect?: (building: VillageBuilding | null) => void;
  /** Callback when a building is hovered */
  onBuildingHover?: (building: VillageBuilding | null) => void;
}

/**
 * Main village canvas content
 * Fetches graph data and renders the village layout
 */
export function VillageCanvas({ onBuildingSelect, onBuildingHover }: VillageCanvasProps) {
  // Fetch layout data
  const { layout, props, villagers, isLoading, isError, isEmpty } = useVillageLayout({
    maxBuildings: 120,
    minSalience: 0,
  });

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
    const newBuilding = isAlreadySelected ? null : building;

    selectBuilding(newBuildingId, newMemoryId);
    onBuildingSelect?.(newBuilding);
  }, [selection.buildingId, selectBuilding, onBuildingSelect]);

  // Handle building hover
  const handleBuildingHover = useCallback((building: VillageBuilding | null) => {
    hoverBuilding(building?.id ?? null);
    onBuildingHover?.(building);
  }, [hoverBuilding, onBuildingHover]);

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
      props={props}
      villagers={villagers}
      selectedBuildingId={selection.buildingId}
      hoveredBuildingId={selection.hoveredBuildingId}
      onBuildingClick={handleBuildingClick}
      onBuildingHover={handleBuildingHover}
    />
  );
}

export default VillageCanvas;
