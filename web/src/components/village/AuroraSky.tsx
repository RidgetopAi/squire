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
    // Only show aurora in upper hemisphere
    float height = normalize(vWorldPosition).y;
    if (height < 0.1) discard;

    // Horizontal position for wave pattern
    float angle = atan(vWorldPosition.x, vWorldPosition.z);

    // Animated waves
    float wave1 = sin(angle * 3.0 + uTime * 0.3) * 0.5 + 0.5;
    float wave2 = sin(angle * 5.0 - uTime * 0.2 + 1.5) * 0.5 + 0.5;
    float wave3 = sin(angle * 2.0 + uTime * 0.15 + 3.0) * 0.5 + 0.5;

    // Combine waves
    float pattern = wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2;

    // Vertical curtain effect - aurora bands
    float curtain = smoothstep(0.3, 0.6, height) * smoothstep(0.95, 0.7, height);
    curtain *= pattern;

    // Shimmer
    float shimmer = 0.8 + 0.2 * sin(uTime * 2.0 + angle * 10.0);

    // Color blend based on pattern
    vec3 color = mix(uColor1, uColor2, wave1);
    color = mix(color, uColor3, wave2 * 0.5);

    // Final alpha
    float alpha = curtain * uIntensity * shimmer;
    alpha *= smoothstep(0.1, 0.3, height); // Fade at horizon

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
