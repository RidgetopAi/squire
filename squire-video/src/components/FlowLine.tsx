import React from 'react';
import {useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors} from '../theme';

interface FlowLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  delay?: number;
  duration?: number;
  strokeWidth?: number;
}

export const FlowLine: React.FC<FlowLineProps> = ({
  x1,
  y1,
  x2,
  y2,
  color = colors.primary,
  delay = 0,
  duration = 20,
  strokeWidth = 2,
}) => {
  const frame = useCurrentFrame();
  const f = frame - delay;

  const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  const dashOffset = interpolate(f, [0, duration], [length, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const opacity = interpolate(f, [0, 5], [0, 0.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <svg
      style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none'}}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={length}
        strokeDashoffset={dashOffset}
        opacity={opacity}
        strokeLinecap="round"
      />
    </svg>
  );
};
