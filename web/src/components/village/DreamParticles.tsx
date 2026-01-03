'use client';

// ============================================
// SQUIRE WEB - DREAM PARTICLES
// ============================================
// Floating dust motes and firefly-like particles
// for dreamy memory village atmosphere

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ============================================
// PARTICLE SHADERS
// ============================================

const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;

  attribute float aScale;
  attribute float aPhase;
  attribute vec3 aVelocity;

  varying float vAlpha;
  varying float vPhase;

  void main() {
    vec3 pos = position;

    // Gentle drift movement
    pos.x += sin(uTime * 0.3 + aPhase * 6.28) * aVelocity.x * 2.0;
    pos.y += mod(uTime * aVelocity.y + aPhase * 10.0, 20.0) - 10.0; // Loop upward
    pos.z += cos(uTime * 0.2 + aPhase * 6.28) * aVelocity.z * 2.0;

    // Swirl around Y axis
    float swirl = uTime * 0.1 + aPhase * 6.28;
    float swirlRadius = 0.5;
    pos.x += sin(swirl) * swirlRadius;
    pos.z += cos(swirl) * swirlRadius;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

    // Size attenuation
    float size = aScale * uPixelRatio * 30.0;
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 50.0);

    gl_Position = projectionMatrix * mvPosition;

    // Fade based on height and time
    float heightFade = smoothstep(-5.0, 0.0, pos.y) * smoothstep(15.0, 5.0, pos.y);
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + aPhase * 6.28);
    vAlpha = heightFade * (0.3 + pulse * 0.7);
    vPhase = aPhase;
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform float uTime;

  varying float vAlpha;
  varying float vPhase;

  void main() {
    // Soft circular particle
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);

    // Soft glow falloff
    float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;

    // Color variation between warm gold and soft violet
    float colorMix = 0.5 + 0.5 * sin(uTime * 0.5 + vPhase * 6.28);
    vec3 color = mix(uColor1, uColor2, colorMix);

    // Add slight glow intensity variation
    color *= 1.0 + 0.3 * sin(uTime * 3.0 + vPhase * 12.56);

    gl_FragColor = vec4(color, alpha);
  }
`;

// ============================================
// DREAM PARTICLES COMPONENT
// ============================================

interface DreamParticlesProps {
  count?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  color1?: string;
  color2?: string;
}

export function DreamParticles({
  count = 500,
  bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 },
  color1 = '#ffd700', // Warm gold
  color2 = '#a78bfa', // Soft violet
}: DreamParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Generate particle attributes
  const { positions, scales, phases, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const phases = new Float32Array(count);
    const velocities = new Float32Array(count * 3);

    const rangeX = bounds.maxX - bounds.minX;
    const rangeZ = bounds.maxZ - bounds.minZ;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Random position within bounds
      positions[i3] = bounds.minX + Math.random() * rangeX;
      positions[i3 + 1] = Math.random() * 15 - 2; // -2 to 13 height
      positions[i3 + 2] = bounds.minZ + Math.random() * rangeZ;

      // Random scale (some bigger "fireflies", many small dust motes)
      scales[i] = Math.random() < 0.1 ? 0.8 + Math.random() * 0.4 : 0.2 + Math.random() * 0.3;

      // Random phase for animation offset
      phases[i] = Math.random();

      // Random velocity for drift
      velocities[i3] = (Math.random() - 0.5) * 0.5;
      velocities[i3 + 1] = 0.1 + Math.random() * 0.3; // Upward drift
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;
    }

    return { positions, scales, phases, velocities };
  }, [count, bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ]);

  // Animation
  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor1: { value: new THREE.Color(color1) },
      uColor2: { value: new THREE.Color(color2) },
    }),
    [color1, color2]
  );

  // Create buffer attributes with useMemo for stability
  const positionAttr = useMemo(
    () => new THREE.BufferAttribute(positions, 3),
    [positions]
  );
  const scaleAttr = useMemo(
    () => new THREE.BufferAttribute(scales, 1),
    [scales]
  );
  const phaseAttr = useMemo(
    () => new THREE.BufferAttribute(phases, 1),
    [phases]
  );
  const velocityAttr = useMemo(
    () => new THREE.BufferAttribute(velocities, 3),
    [velocities]
  );

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={positionAttr} />
        <primitive attach="attributes-aScale" object={scaleAttr} />
        <primitive attach="attributes-aPhase" object={phaseAttr} />
        <primitive attach="attributes-aVelocity" object={velocityAttr} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particleVertexShader}
        fragmentShader={particleFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ============================================
// FIREFLIES (LARGER, SLOWER, FEWER)
// ============================================

export function Fireflies({
  count = 30,
  bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 },
}: {
  count?: number;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}) {
  return (
    <DreamParticles
      count={count}
      bounds={bounds}
      color1="#ffdd44"
      color2="#ff9944"
    />
  );
}

export default DreamParticles;
