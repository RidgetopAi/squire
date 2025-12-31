// ============================================
// SQUIRE WEB - VILLAGE LAYOUT LIBRARY
// ============================================

// Hex grid utilities
export {
  hexToWorld,
  worldToHex,
  spiralHexPositions,
  hexDistance,
  worldDistance,
  calculateBounds,
  hexAdd,
  hexScale,
  hexNeighbors,
  DEFAULT_HEX_SIZE,
} from './hexGrid';

// Layout algorithm
export {
  buildVillageLayout,
  createEmptyLayout,
  getBuildingById,
  getBuildingByMemoryId,
  getConnectedRoads,
} from './layout';

// GLTF model utilities (Phase 3)
export {
  MODELS_BASE_PATH,
  BUILDING_MODEL_CONFIGS,
  ALL_BUILDING_TYPES,
  getModelPath,
  getModelConfig,
  preloadAllBuildingModels,
  preloadBuildingModels,
  clearModelCache,
  hasModel,
  FALLBACK_MODEL_PATH,
} from './models';
export type { BuildingModelConfig } from './models';
