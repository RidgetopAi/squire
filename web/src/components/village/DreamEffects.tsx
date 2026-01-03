'use client';

// ============================================
// SQUIRE WEB - DREAM EFFECTS
// ============================================
// Post-processing effects for dreamy memory village
// Bloom, vignette, chromatic aberration

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  Vignette,
  ChromaticAberration,
  DepthOfField,
  Noise,
} from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import * as THREE from 'three';

// ============================================
// DREAM POST-PROCESSING COMPONENT
// ============================================

interface DreamEffectsProps {
  /** Bloom intensity (0-1) */
  bloomIntensity?: number;
  /** Vignette darkness (0-1) */
  vignetteDarkness?: number;
  /** Chromatic aberration offset */
  chromaticOffset?: number;
  /** Enable depth of field */
  enableDOF?: boolean;
  /** Enable subtle noise/grain */
  enableNoise?: boolean;
}

export function DreamEffects({
  bloomIntensity = 0.6,
  vignetteDarkness = 0.5,
  chromaticOffset = 0.002,
  enableDOF = false,
  enableNoise = true,
}: DreamEffectsProps) {
  const chromaticRef = useRef<THREE.Vector2 | null>(null);

  // Subtle animated chromatic aberration
  useFrame(({ clock }) => {
    if (chromaticRef.current) {
      const time = clock.getElapsedTime();
      const offset = chromaticOffset * (1 + Math.sin(time * 0.5) * 0.3);
      chromaticRef.current.set(offset, offset);
    }
  });

  // Use different composer configurations based on options
  if (enableDOF && enableNoise) {
    return (
      <EffectComposer>
        <Bloom
          intensity={bloomIntensity}
          kernelSize={KernelSize.LARGE}
          luminanceThreshold={0.4}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <Vignette
          offset={0.3}
          darkness={vignetteDarkness}
          blendFunction={BlendFunction.NORMAL}
        />
        <ChromaticAberration
          offset={new THREE.Vector2(chromaticOffset, chromaticOffset)}
          blendFunction={BlendFunction.NORMAL}
          radialModulation={true}
          modulationOffset={0.5}
        />
        <DepthOfField
          focusDistance={0.02}
          focalLength={0.05}
          bokehScale={3}
        />
        <Noise
          opacity={0.08}
          blendFunction={BlendFunction.SOFT_LIGHT}
        />
      </EffectComposer>
    );
  }

  if (enableDOF) {
    return (
      <EffectComposer>
        <Bloom
          intensity={bloomIntensity}
          kernelSize={KernelSize.LARGE}
          luminanceThreshold={0.4}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <Vignette
          offset={0.3}
          darkness={vignetteDarkness}
          blendFunction={BlendFunction.NORMAL}
        />
        <ChromaticAberration
          offset={new THREE.Vector2(chromaticOffset, chromaticOffset)}
          blendFunction={BlendFunction.NORMAL}
          radialModulation={true}
          modulationOffset={0.5}
        />
        <DepthOfField
          focusDistance={0.02}
          focalLength={0.05}
          bokehScale={3}
        />
      </EffectComposer>
    );
  }

  if (enableNoise) {
    return (
      <EffectComposer>
        <Bloom
          intensity={bloomIntensity}
          kernelSize={KernelSize.LARGE}
          luminanceThreshold={0.4}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <Vignette
          offset={0.3}
          darkness={vignetteDarkness}
          blendFunction={BlendFunction.NORMAL}
        />
        <ChromaticAberration
          offset={new THREE.Vector2(chromaticOffset, chromaticOffset)}
          blendFunction={BlendFunction.NORMAL}
          radialModulation={true}
          modulationOffset={0.5}
        />
        <Noise
          opacity={0.08}
          blendFunction={BlendFunction.SOFT_LIGHT}
        />
      </EffectComposer>
    );
  }

  // Base effects only
  return (
    <EffectComposer>
      <Bloom
        intensity={bloomIntensity}
        kernelSize={KernelSize.LARGE}
        luminanceThreshold={0.4}
        luminanceSmoothing={0.9}
        mipmapBlur
      />
      <Vignette
        offset={0.3}
        darkness={vignetteDarkness}
        blendFunction={BlendFunction.NORMAL}
      />
      <ChromaticAberration
        offset={new THREE.Vector2(chromaticOffset, chromaticOffset)}
        blendFunction={BlendFunction.NORMAL}
        radialModulation={true}
        modulationOffset={0.5}
      />
    </EffectComposer>
  );
}

// ============================================
// PRESET CONFIGURATIONS
// ============================================

/** Soft dreamy preset - gentle effects */
export function DreamEffectsSoft() {
  return (
    <DreamEffects
      bloomIntensity={0.4}
      vignetteDarkness={0.4}
      chromaticOffset={0.001}
      enableNoise={false}
    />
  );
}

/** Intense dreamy preset - stronger effects */
export function DreamEffectsIntense() {
  return (
    <DreamEffects
      bloomIntensity={0.8}
      vignetteDarkness={0.6}
      chromaticOffset={0.003}
      enableNoise={true}
      enableDOF={true}
    />
  );
}

/** Memory haze preset - foggy, nostalgic */
export function DreamEffectsNostalgic() {
  return (
    <DreamEffects
      bloomIntensity={0.7}
      vignetteDarkness={0.55}
      chromaticOffset={0.002}
      enableNoise={true}
    />
  );
}

export default DreamEffects;
