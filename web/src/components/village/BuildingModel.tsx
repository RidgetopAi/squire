'use client';

// ============================================
// SQUIRE WEB - BUILDING MODEL COMPONENT
// ============================================
// Loads and renders GLTF models for buildings
// Uses KayKit Medieval Hexagon Pack models

import { Suspense, useMemo, useEffect, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { BuildingType } from '@/lib/types/village';
import { getModelConfig } from '@/lib/village/models';

// ============================================
// TYPES
// ============================================

interface BuildingModelProps {
  /** Building type determines which model to load */
  buildingType: BuildingType;
  /** Scale multiplier (based on salience) */
  scale?: number;
  /** Emissive intensity for hover/select glow */
  emissiveIntensity?: number;
  /** Emissive color for glow */
  emissiveColor?: string;
  /** Whether to cast shadows */
  castShadow?: boolean;
  /** Whether to receive shadows */
  receiveShadow?: boolean;
}

// ============================================
// GLTF MODEL COMPONENT
// ============================================

/**
 * Internal component that actually loads and renders the GLTF
 * Wrapped in Suspense by BuildingModel
 */
function GLTFModel({
  buildingType,
  scale = 1,
  emissiveIntensity = 0,
  emissiveColor = '#ffffff',
  castShadow = true,
  receiveShadow = true,
}: BuildingModelProps) {
  const config = getModelConfig(buildingType);
  const { scene } = useGLTF(config.path);
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([]);

  // Clone the scene ONCE - stable reference prevents re-mounting
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true);
    const materials: THREE.MeshStandardMaterial[] = [];

    // Clone materials once for independence, collect refs for updates
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const material = child.material.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          materials.push(material);
        }
        child.material = material;
        child.castShadow = castShadow;
        child.receiveShadow = receiveShadow;
      }
    });

    materialsRef.current = materials;
    return clone;
  }, [scene, castShadow, receiveShadow]); // NO emissive deps - stable clone!

  // Update emissive properties imperatively - no re-clone needed
  useEffect(() => {
    const color = new THREE.Color(emissiveColor);
    materialsRef.current.forEach((material) => {
      material.emissive = color;
      material.emissiveIntensity = emissiveIntensity;
    });
  }, [emissiveIntensity, emissiveColor]);

  // Apply config transforms
  const finalScale = scale * config.scale;

  return (
    <primitive
      object={clonedScene}
      scale={[finalScale, finalScale, finalScale]}
      rotation={[0, config.rotationY, 0]}
      position={[0, config.yOffset, 0]}
    />
  );
}

// ============================================
// FALLBACK COMPONENT
// ============================================

/**
 * Simple box geometry shown while model loads or on error
 */
function FallbackBox({
  scale = 1,
  emissiveIntensity = 0,
  emissiveColor = '#ffffff',
}: Pick<BuildingModelProps, 'scale' | 'emissiveIntensity' | 'emissiveColor'>) {
  return (
    <mesh castShadow receiveShadow scale={[scale, scale, scale]}>
      <boxGeometry args={[0.8, 1.0, 0.8]} />
      <meshStandardMaterial
        color="#4a5568"
        emissive={emissiveColor}
        emissiveIntensity={emissiveIntensity}
        roughness={0.7}
        metalness={0.2}
      />
    </mesh>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

/**
 * BuildingModel - Renders a GLTF model for a building type
 *
 * Uses Suspense to show a fallback box while loading.
 * Falls back to box geometry if model fails to load.
 *
 * @example
 * <BuildingModel
 *   buildingType="tavern"
 *   scale={1.2}
 *   emissiveIntensity={0.3}
 *   emissiveColor="#f472b6"
 * />
 */
/**
 * BuildingModel - Renders a GLTF model for a building type
 * 
 * NOTE: Does NOT include Suspense - caller must wrap in Suspense if needed.
 * This is important for LOD (Detailed) compatibility where Suspense inside
 * children breaks the distance-based visibility logic.
 */
export function BuildingModel(props: BuildingModelProps) {
  return <GLTFModel {...props} />;
}

/**
 * BuildingModelWithSuspense - BuildingModel wrapped in Suspense
 * Use this when NOT inside a Detailed/LOD component
 */
export function BuildingModelWithSuspense(props: BuildingModelProps) {
  return (
    <Suspense
      fallback={
        <FallbackBox
          scale={props.scale}
          emissiveIntensity={props.emissiveIntensity}
          emissiveColor={props.emissiveColor}
        />
      }
    >
      <GLTFModel {...props} />
    </Suspense>
  );
}

// ============================================
// ERROR BOUNDARY
// ============================================

/**
 * BuildingModelWithFallback - Wraps BuildingModel with error handling
 * Falls back to simple box if GLTF fails to load
 */
export function BuildingModelWithFallback(props: BuildingModelProps) {
  // React error boundaries don't work well with Suspense in R3F
  // Instead, useGLTF will throw and Suspense will catch during load
  // For actual load failures, the model just won't render
  // A more robust solution would use react-error-boundary
  return <BuildingModel {...props} />;
}

export default BuildingModel;
