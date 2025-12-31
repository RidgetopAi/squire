'use client';

// ============================================
// SQUIRE WEB - DISTRICT GROUND COMPONENT
// ============================================
// Renders hex tile ground for village districts

import { useMemo } from 'react';
import type { VillageLayout, VillageDistrict, MemoryCategory, HexCoord } from '@/lib/types/village';
import { worldToHex, hexToWorld, DEFAULT_HEX_SIZE } from '@/lib/village/hexGrid';
import { HexTilesLayer, DISTRICT_GROUND_COLORS } from './HexTile';

// ============================================
// HEX GRID GENERATION
// ============================================

/**
 * Generate hex coordinates that cover a rectangular bounds area
 * @param bounds - World coordinate bounds
 * @param hexSize - Size of hex tiles
 * @param padding - Extra tiles around edges
 */
function generateHexGridForBounds(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  hexSize: number,
  padding: number = 1
): HexCoord[] {
  const hexCoords: HexCoord[] = [];
  const seen = new Set<string>();

  // Convert bounds corners to hex coordinates
  const minHex = worldToHex({ x: bounds.minX, z: bounds.minZ }, hexSize);
  const maxHex = worldToHex({ x: bounds.maxX, z: bounds.maxZ }, hexSize);

  // Expand range with padding
  const qMin = minHex.q - padding;
  const qMax = maxHex.q + padding;
  const rMin = minHex.r - padding;
  const rMax = maxHex.r + padding;

  // Iterate through hex grid range
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const key = `${q},${r}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Verify this hex overlaps with bounds
      const worldPos = hexToWorld({ q, r }, hexSize);
      const inBounds =
        worldPos.x >= bounds.minX - hexSize * 2 &&
        worldPos.x <= bounds.maxX + hexSize * 2 &&
        worldPos.z >= bounds.minZ - hexSize * 2 &&
        worldPos.z <= bounds.maxZ + hexSize * 2;

      if (inBounds) {
        hexCoords.push({ q, r });
      }
    }
  }

  return hexCoords;
}

// ============================================
// SINGLE DISTRICT GROUND
// ============================================

export interface DistrictGroundProps {
  /** District data */
  district: VillageDistrict;
  /** Hex tile size */
  hexSize?: number;
  /** Padding tiles around district */
  padding?: number;
}

/**
 * Render hex tile ground for a single district
 */
export function DistrictGround({
  district,
  hexSize = DEFAULT_HEX_SIZE,
  padding = 1,
}: DistrictGroundProps) {
  // Generate hex tiles for this district
  const tiles = useMemo(() => {
    const hexCoords = generateHexGridForBounds(district.bounds, hexSize, padding);
    return hexCoords.map(coord => ({
      coord,
      category: district.category,
    }));
  }, [district.bounds, district.category, hexSize, padding]);

  return (
    <HexTilesLayer
      tiles={tiles}
      hexSize={hexSize}
      yOffset={-0.01} // Slightly below y=0
    />
  );
}

// ============================================
// ALL DISTRICTS GROUND
// ============================================

export interface VillageGroundProps {
  /** Village layout containing districts */
  layout: VillageLayout;
  /** Hex tile size */
  hexSize?: number;
  /** Padding tiles around each district */
  padding?: number;
  /** Show center connector tiles */
  showConnector?: boolean;
}

/**
 * Render hex tile ground for all village districts
 */
export function VillageGround({
  layout,
  hexSize = DEFAULT_HEX_SIZE,
  padding = 1,
  showConnector = true,
}: VillageGroundProps) {
  // Generate tiles for all districts plus connector
  const allTiles = useMemo(() => {
    const tiles: { coord: HexCoord; category: MemoryCategory }[] = [];
    const seen = new Set<string>();

    // Add tiles for each district
    for (const district of layout.districts) {
      const hexCoords = generateHexGridForBounds(district.bounds, hexSize, padding);
      for (const coord of hexCoords) {
        const key = `${coord.q},${coord.r}`;
        if (!seen.has(key)) {
          seen.add(key);
          tiles.push({ coord, category: district.category });
        }
      }
    }

    // Add connector tiles in center (misc category)
    if (showConnector) {
      const centerRange = 3;
      for (let q = -centerRange; q <= centerRange; q++) {
        for (let r = -centerRange; r <= centerRange; r++) {
          const key = `${q},${r}`;
          if (!seen.has(key)) {
            seen.add(key);
            tiles.push({ coord: { q, r }, category: 'misc' });
          }
        }
      }
    }

    return tiles;
  }, [layout.districts, hexSize, padding, showConnector]);

  return (
    <group>
      <HexTilesLayer
        tiles={allTiles}
        hexSize={hexSize}
        yOffset={-0.01}
      />

      {/* Shadow receiver plane (invisible but catches shadows) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
    </group>
  );
}

export default VillageGround;
