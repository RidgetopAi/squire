// ============================================
// SQUIRE WEB - VILLAGE GLTF MODELS
// ============================================
// GLTF model configuration and preloading utilities
// Phase 3: KayKit medieval building integration

import { useGLTF } from '@react-three/drei';
import type { BuildingType } from '@/lib/types/village';

// ============================================
// MODEL PATHS
// ============================================

/**
 * Base path for all building models
 */
export const MODELS_BASE_PATH = '/models/buildings';

/**
 * Model configuration for each building type
 */
export interface BuildingModelConfig {
  /** Path to GLTF file (relative to public/) */
  path: string;
  /** Default scale multiplier */
  scale: number;
  /** Y-axis rotation in radians (for proper orientation) */
  rotationY: number;
  /** Y offset to place building on ground */
  yOffset: number;
}

/**
 * GLTF model paths for each building type
 * Uses KayKit Medieval Hexagon Pack (CC0 license)
 * https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0
 *
 * Model mappings:
 * - tavern: building_tavern_blue
 * - library: building_tower_A_blue
 * - blacksmith: building_blacksmith_blue
 * - church: building_church_blue
 * - market: building_market_blue
 * - barracks: building_barracks_blue
 * - house: building_home_A_blue
 */
export const BUILDING_MODEL_CONFIGS: Record<BuildingType, BuildingModelConfig> = {
  tavern: {
    path: `${MODELS_BASE_PATH}/tavern.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
  library: {
    path: `${MODELS_BASE_PATH}/library.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
  blacksmith: {
    path: `${MODELS_BASE_PATH}/blacksmith.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
  church: {
    path: `${MODELS_BASE_PATH}/church.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
  market: {
    path: `${MODELS_BASE_PATH}/market.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
  barracks: {
    path: `${MODELS_BASE_PATH}/barracks.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
  house: {
    path: `${MODELS_BASE_PATH}/house.gltf`,
    scale: 1.0,
    rotationY: 0,
    yOffset: 0,
  },
};

// ============================================
// PRELOADING
// ============================================

/**
 * All building types for iteration
 */
export const ALL_BUILDING_TYPES: BuildingType[] = [
  'tavern',
  'library',
  'blacksmith',
  'church',
  'market',
  'barracks',
  'house',
];

/**
 * Get the model path for a building type
 */
export function getModelPath(buildingType: BuildingType): string {
  return BUILDING_MODEL_CONFIGS[buildingType].path;
}

/**
 * Get the full model config for a building type
 */
export function getModelConfig(buildingType: BuildingType): BuildingModelConfig {
  return BUILDING_MODEL_CONFIGS[buildingType];
}

/**
 * Preload all building models
 * Call this in VillageCanvas or a parent component to start loading models early
 *
 * @example
 * // In VillageCanvas.tsx or VillageScene.tsx:
 * useEffect(() => {
 *   preloadAllBuildingModels();
 * }, []);
 */
export function preloadAllBuildingModels(): void {
  ALL_BUILDING_TYPES.forEach((type) => {
    const path = getModelPath(type);
    useGLTF.preload(path);
  });
}

/**
 * Preload specific building types (useful for visible buildings only)
 */
export function preloadBuildingModels(types: BuildingType[]): void {
  types.forEach((type) => {
    const path = getModelPath(type);
    useGLTF.preload(path);
  });
}

/**
 * Clear cached models (useful for memory management)
 */
export function clearModelCache(): void {
  ALL_BUILDING_TYPES.forEach((type) => {
    const path = getModelPath(type);
    useGLTF.clear(path);
  });
}

// ============================================
// MODEL LOADING HOOK HELPERS
// ============================================

/**
 * Check if a model file exists for this building type
 * All 7 building types now have KayKit models available
 */
export function hasModel(buildingType: BuildingType): boolean {
  // All building types have models from KayKit Medieval Hexagon Pack
  return ALL_BUILDING_TYPES.includes(buildingType);
}

/**
 * Fallback model path (simple geometry) - used when model fails to load
 * The Building component will use box geometry as fallback
 */
export const FALLBACK_MODEL_PATH = null;
