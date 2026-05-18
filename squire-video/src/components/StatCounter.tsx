import React from 'react';
import {useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';

interface StatCounterProps {
  target: number;
  label: string;
  suffix?: string;
  prefix?: string;
  delay?: number;
  duration?: number;
  color?: string;
  fontSize?: number;
}

export const StatCounter: React.FC<StatCounterProps> = ({
  target,
  label,
  suffix = '',
  prefix = '',
  delay = 0,
  duration = 40,
  color = colors.primary,
  fontSize = 64,
}) => {
  const frame = useCurrentFrame();
  const f = frame - delay;

  const value = interpolate(f, [0, duration], [0, target], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const opacity = interpolate(f, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const translateY = interpolate(f, [0, 15], [20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const displayValue = target >= 1000
    ? `${(Math.round(value) / 1000).toFixed(value >= target ? 0 : 1)}K`
    : `${Math.round(value)}`;

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize,
          fontWeight: 700,
          color,
          fontFamily: fonts.mono,
          letterSpacing: '-0.02em',
        }}
      >
        {prefix}{displayValue}{suffix}
      </div>
      <div
        style={{
          fontSize: fontSize * 0.3,
          color: colors.fgMuted,
          fontFamily: fonts.sans,
          marginTop: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        {label}
      </div>
    </div>
  );
};
