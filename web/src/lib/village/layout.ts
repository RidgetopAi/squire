// ============================================
// SQUIRE WEB - VILLAGE LAYOUT ALGORITHM
// ============================================
// Transforms graph API data into village layout

import type { ForceGraphData, ForceGraphNode, ForceGraphLink } from '@/lib/api/graph';
import type {
  VillageLayout,
  VillageBuilding,
  VillageRoad,
  VillageDistrict,
  VillageLayoutOptions,
  MemoryCategory,
  BuildingType,
  HexCoord,
  VillagePosition,
} from '@/lib/types/village';
import {
  DISTRICT_LAYOUT,
  CATEGORY_TO_BUILDING,
  BUILDING_COLORS,
  CATEGORY_KEYWORDS,
} from '@/lib/types/village';
import {
  hexToWorld,
  hexAdd,
  spiralHexPositions,
  calculateBounds,
  DEFAULT_HEX_SIZE,
} from './hexGrid';

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_OPTIONS: Required<VillageLayoutOptions> = {
  maxBuildings: 120,
  hexSize: DEFAULT_HEX_SIZE,
  minSalience: 0,
  districtSpacing: 1.5, // Multiplier for district spread
};

// ============================================
// MAIN LAYOUT FUNCTION
// ============================================

/**
 * Transform graph visualization data into village layout
 *
 * @param graphData - Force graph data from API
 * @param options - Layout options
 * @returns Complete village layout ready for rendering
 */
export function buildVillageLayout(
  graphData: ForceGraphData,
  options: VillageLayoutOptions = {}
): VillageLayout {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Filter to memory nodes only (entities become decorations in Phase 3)
  const memoryNodes = graphData.nodes.filter(node => node.type === 'memory');

  console.log('[buildVillageLayout] Input:', {
    totalNodes: graphData.nodes.length,
    memoryNodes: memoryNodes.length,
    nodeTypes: [...new Set(graphData.nodes.map(n => n.type))],
  });

  // Sort by salience (highest first) and filter by min salience
  const sortedMemories = memoryNodes
    .filter(node => {
      const salience = (node.attributes?.salience as number) ?? 0.5;
      return salience >= opts.minSalience;
    })
    .sort((a, b) => {
      const salienceA = (a.attributes?.salience as number) ?? 0.5;
      const salienceB = (b.attributes?.salience as number) ?? 0.5;
      return salienceB - salienceA;
    });

  // Cap to max buildings
  const memoriesSkipped = Math.max(0, sortedMemories.length - opts.maxBuildings);
  const memoriesToPlace = sortedMemories.slice(0, opts.maxBuildings);

  // Categorize memories into districts
  const categorized = categorizeMemories(memoriesToPlace);

  // Place buildings in districts
  const buildings = placeBuildingsInDistricts(categorized, opts);

  // Create building ID lookup for road generation
  const buildingByMemoryId = new Map(buildings.map(b => [b.memoryId, b]));

  // Generate roads from graph edges
  const roads = generateRoads(graphData.links, buildingByMemoryId);

  // Calculate district bounds
  const districts = calculateDistricts(buildings);

  // Calculate overall bounds
  const allPositions = buildings.map(b => b.position);
  const bounds = calculateBounds(allPositions);

  // Add padding to bounds
  const padding = opts.hexSize * 2;
  bounds.minX -= padding;
  bounds.maxX += padding;
  bounds.minZ -= padding;
  bounds.maxZ += padding;

  return {
    buildings,
    roads,
    districts,
    bounds,
    stats: {
      totalBuildings: buildings.length,
      totalRoads: roads.length,
      memoriesSkipped,
    },
  };
}

// ============================================
// MEMORY CATEGORIZATION
// ============================================

/**
 * Categorize memories into districts based on tags and content
 */
function categorizeMemories(
  memories: ForceGraphNode[]
): Map<MemoryCategory, ForceGraphNode[]> {
  const categorized = new Map<MemoryCategory, ForceGraphNode[]>();

  // Initialize all categories
  for (const category of Object.keys(DISTRICT_LAYOUT) as MemoryCategory[]) {
    categorized.set(category, []);
  }

  for (const memory of memories) {
    const category = classifyMemory(memory);
    categorized.get(category)!.push(memory);
  }

  return categorized;
}

/**
 * Classify a single memory into a category
 */
function classifyMemory(memory: ForceGraphNode): MemoryCategory {
  const label = memory.label.toLowerCase();
  const tags = (memory.attributes?.tags as string[]) ?? [];
  const content = (memory.attributes?.content as string) ?? '';
  const textToSearch = `${label} ${tags.join(' ')} ${content}`.toLowerCase();

  // Check each category's keywords
  let bestCategory: MemoryCategory = 'misc';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [MemoryCategory, string[]][]) {
    if (keywords.length === 0) continue; // Skip misc

    let score = 0;
    for (const keyword of keywords) {
      if (textToSearch.includes(keyword)) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // If no keywords matched, check tags for direct category matches
  if (bestScore === 0) {
    const tagStr = tags.join(' ').toLowerCase();
    for (const category of Object.keys(DISTRICT_LAYOUT) as MemoryCategory[]) {
      if (tagStr.includes(category)) {
        return category;
      }
    }
  }

  return bestCategory;
}

// ============================================
// BUILDING PLACEMENT
// ============================================

/**
 * Place buildings within their districts using spiral placement
 */
function placeBuildingsInDistricts(
  categorized: Map<MemoryCategory, ForceGraphNode[]>,
  opts: Required<VillageLayoutOptions>
): VillageBuilding[] {
  const buildings: VillageBuilding[] = [];

  for (const [category, memories] of categorized) {
    if (memories.length === 0) continue;

    // Get district center offset
    const districtOffset = DISTRICT_LAYOUT[category];
    if (!districtOffset) {
      console.warn('[placeBuildingsInDistricts] No district offset for category:', category);
      continue;
    }

    // Scale the district offset for spacing
    const scaledOffset: HexCoord = {
      q: Math.round(districtOffset.q * opts.districtSpacing),
      r: Math.round(districtOffset.r * opts.districtSpacing),
    };

    // Generate spiral positions for this district
    const spiralPositions = spiralHexPositions(memories.length);

    console.log(`[placeBuildingsInDistricts] ${category}: ${memories.length} memories, ${spiralPositions.length} positions`);

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const localHex = spiralPositions[i];

      // Safety check for missing spiral position
      if (!localHex) {
        console.warn(`[placeBuildingsInDistricts] Missing spiral position at index ${i} for ${category}`);
        continue;
      }

      // Combine district offset with local position
      const hexCoord = hexAdd(scaledOffset, localHex);
      const position = hexToWorld(hexCoord, opts.hexSize);

      // Validate position
      if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) {
        console.warn('[placeBuildingsInDistricts] NaN position:', {
          memoryId: memory.id,
          category,
          index: i,
          localHex,
          scaledOffset,
          hexCoord,
          position,
          hexSize: opts.hexSize,
        });
        continue;
      }

      // Extract memory attributes
      const salience = (memory.attributes?.salience as number) ?? 0.5;
      const emotionalValence = (memory.attributes?.emotionalValence as number) ?? 0;

      // Determine building type
      const buildingType: BuildingType = CATEGORY_TO_BUILDING[category];

      buildings.push({
        id: `building-${memory.id}`,
        memoryId: memory.id,
        position,
        hexCoord,
        buildingType,
        category,
        label: memory.label,
        salience,
        emotionalValence,
        color: BUILDING_COLORS[buildingType],
        district: category,
      });
    }
  }

  return buildings;
}

// ============================================
// ROAD GENERATION
// ============================================

/**
 * Generate roads from graph edges between placed buildings
 */
function generateRoads(
  edges: ForceGraphLink[],
  buildingByMemoryId: Map<string, VillageBuilding>
): VillageRoad[] {
  const roads: VillageRoad[] = [];
  const roadSet = new Set<string>(); // Prevent duplicate roads

  for (const edge of edges) {
    // Get source and target as strings (may be objects after force graph processing)
    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as { id: string }).id;
    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as { id: string }).id;

    const fromBuilding = buildingByMemoryId.get(sourceId);
    const toBuilding = buildingByMemoryId.get(targetId);

    // Only create roads between placed buildings
    if (!fromBuilding || !toBuilding) continue;

    // Skip self-loops
    if (fromBuilding.id === toBuilding.id) continue;

    // Create unique road ID (sorted to prevent duplicates)
    const roadKey = [fromBuilding.id, toBuilding.id].sort().join('-');
    if (roadSet.has(roadKey)) continue;
    roadSet.add(roadKey);

    roads.push({
      id: `road-${roadKey}`,
      fromId: fromBuilding.id,
      toId: toBuilding.id,
      fromPosition: fromBuilding.position,
      toPosition: toBuilding.position,
      weight: edge.weight,
      edgeType: edge.type,
    });
  }

  return roads;
}

// ============================================
// DISTRICT CALCULATION
// ============================================

/**
 * Calculate district boundaries from placed buildings
 */
function calculateDistricts(buildings: VillageBuilding[]): VillageDistrict[] {
  const districtBuildings = new Map<MemoryCategory, VillageBuilding[]>();

  // Group buildings by district
  for (const building of buildings) {
    const category = building.category;
    if (!districtBuildings.has(category)) {
      districtBuildings.set(category, []);
    }
    districtBuildings.get(category)!.push(building);
  }

  // Calculate district info
  const districts: VillageDistrict[] = [];

  for (const [category, districtBldgs] of districtBuildings) {
    if (districtBldgs.length === 0) continue;

    // Calculate center (average position)
    const sumX = districtBldgs.reduce((sum, b) => sum + b.position.x, 0);
    const sumZ = districtBldgs.reduce((sum, b) => sum + b.position.z, 0);

    const center: VillagePosition = {
      x: sumX / districtBldgs.length,
      z: sumZ / districtBldgs.length,
    };

    // Calculate bounds
    const positions = districtBldgs.map(b => b.position);
    const bounds = calculateBounds(positions);

    districts.push({
      category,
      center,
      buildingCount: districtBldgs.length,
      bounds,
    });
  }

  return districts;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Create an empty layout (for loading/error states)
 */
export function createEmptyLayout(): VillageLayout {
  return {
    buildings: [],
    roads: [],
    districts: [],
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    stats: {
      totalBuildings: 0,
      totalRoads: 0,
      memoriesSkipped: 0,
    },
  };
}

/**
 * Get building by ID from layout
 */
export function getBuildingById(
  layout: VillageLayout,
  buildingId: string
): VillageBuilding | undefined {
  return layout.buildings.find(b => b.id === buildingId);
}

/**
 * Get building by memory ID from layout
 */
export function getBuildingByMemoryId(
  layout: VillageLayout,
  memoryId: string
): VillageBuilding | undefined {
  return layout.buildings.find(b => b.memoryId === memoryId);
}

/**
 * Get roads connected to a building
 */
export function getConnectedRoads(
  layout: VillageLayout,
  buildingId: string
): VillageRoad[] {
  return layout.roads.filter(r => r.fromId === buildingId || r.toId === buildingId);
}
