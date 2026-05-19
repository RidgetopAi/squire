import React from 'react';
import {useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors} from '../theme';

interface GraphNodeProps {
  x: number;
  y: number;
  label: string;
  color?: string;
  size?: number;
  delay?: number;
  glowing?: boolean;
  fontSize?: number;
}

export const GraphNode: React.FC<GraphNodeProps> = ({
  x,
  y,
  label,
  color = colors.primary,
  size = 40,
  delay = 0,
  glowing = false,
  fontSize = 12,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const scale = spring({
    frame: frame - delay,
    fps,
    config: {damping: 12, stiffness: 100, mass: 0.5},
  });

  const glowOpacity = glowing
    ? interpolate(Math.sin(frame * 0.08), [-1, 1], [0.3, 0.7])
    : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        transform: `scale(${scale})`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {glowing && (
        <div
          style={{
            position: 'absolute',
            width: size * 2,
            height: size * 2,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${color}44, transparent)`,
            opacity: glowOpacity,
            left: -size / 2,
            top: -size / 2,
          }}
        />
      )}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${color}, ${color}88)`,
          border: `2px solid ${color}`,
          boxShadow: `0 0 12px ${color}44`,
        }}
      />
      <div
        style={{
          marginTop: 6,
          fontSize,
          color: colors.fgMuted,
          fontFamily: 'Inter, sans-serif',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {label}
      </div>
    </div>
  );
};
