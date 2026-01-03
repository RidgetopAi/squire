'use client';

// ============================================
// SQUIRE WEB - AURORA SKY
// ============================================
// Animated aurora borealis effect on sky dome
// Performance-friendly dreamy atmosphere

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ============================================
// AURORA SHADERS
// ============================================

const auroraVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const auroraFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uIntensity;

  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    // Normalize to get sphere position
    vec3 dir = normalize(vWorldPosition);
    float height = dir.y;

    // Show aurora from horizon (-0.1) to top
    // Discard only below horizon
    if (height < -0.15) discard;

    // Horizontal position for wave pattern
    float angle = atan(vWorldPosition.x, vWorldPosition.z);

    // Animated waves - slower, more dreamy
    float wave1 = sin(angle * 2.0 + uTime * 0.2) * 0.5 + 0.5;
    float wave2 = sin(angle * 4.0 - uTime * 0.15 + 1.5) * 0.5 + 0.5;
    float wave3 = sin(angle * 1.5 + uTime * 0.1 + 3.0) * 0.5 + 0.5;

    // Combine waves
    float pattern = wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2;

    // Curtain effect - strongest near horizon, fading up
    // This creates the "surrounding" feel
    float curtain = smoothstep(-0.1, 0.2, height) * smoothstep(0.9, 0.4, height);

    // Add extra band near horizon
    float horizonBand = smoothstep(-0.1, 0.05, height) * smoothstep(0.3, 0.1, height);
    curtain = max(curtain, horizonBand * 0.7);

    curtain *= pattern;

    // Gentle shimmer
    float shimmer = 0.85 + 0.15 * sin(uTime * 1.5 + angle * 8.0);

    // Color blend - more variety
    vec3 color = mix(uColor1, uColor2, wave1);
    color = mix(color, uColor3, wave2 * 0.4);

    // Warmer tint near horizon
    color = mix(color, uColor1 * 1.2, horizonBand * 0.3);

    // Final alpha - stronger overall
    float alpha = curtain * uIntensity * shimmer * 1.3;

    // Smooth fade at very bottom
    alpha *= smoothstep(-0.15, 0.0, height);

    gl_FragColor = vec4(color, alpha);
  }
`;

// ============================================
// AURORA SKY COMPONENT
// ============================================

interface AuroraSkyProps {
  radius?: number;
  color1?: string;
  color2?: string;
  color3?: string;
  intensity?: number;
}

export function AuroraSky({
  radius = 80,
  color1 = '#8b5cf6', // Violet
  color2 = '#3b82f6', // Blue
  color3 = '#10b981', // Emerald
  intensity = 0.4,
}: AuroraSkyProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(color1) },
      uColor2: { value: new THREE.Color(color2) },
      uColor3: { value: new THREE.Color(color3) },
      uIntensity: { value: intensity },
    }),
    [color1, color2, color3, intensity]
  );

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  return (
    <mesh>
      <sphereGeometry args={[radius, 32, 16]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={auroraVertexShader}
        fragmentShader={auroraFragmentShader}
        uniforms={uniforms}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export default AuroraSky;
