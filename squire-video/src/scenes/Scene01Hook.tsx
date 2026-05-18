import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';

export const Scene01Hook: React.FC = () => {
  const frame = useCurrentFrame();

  // Line 1: "This is not user memory." (0-60)
  const line1Opacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const line1Y = interpolate(frame, [10, 35], [20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Line 1 fade out
  const line1FadeOut = interpolate(frame, [65, 80], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Line 2: "This is AI memory that knows the user." (60-120)
  const line2Opacity = interpolate(frame, [70, 95], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const line2Y = interpolate(frame, [70, 100], [20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // "AI memory" highlight
  const highlightOpacity = interpolate(frame, [100, 115], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // SQUIRE wordmark (120-180)
  const wordmarkOpacity = interpolate(frame, [125, 150], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const wordmarkScale = interpolate(frame, [125, 155], [0.85, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Subtle terracotta glow behind wordmark
  const glowPulse = interpolate(
    Math.sin(frame * 0.05),
    [-1, 1],
    [0.15, 0.35],
  );

  // Divider line
  const lineWidth = interpolate(frame, [120, 145], [0, 200], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: fonts.sans,
      }}
    >
      {/* Line 1 */}
      <div
        style={{
          opacity: line1Opacity * line1FadeOut,
          transform: `translateY(${line1Y}px)`,
          fontSize: 52,
          color: colors.fgMuted,
          fontWeight: 300,
          letterSpacing: '-0.01em',
          position: 'absolute',
        }}
      >
        This is not user memory.
      </div>

      {/* Line 2 */}
      <div
        style={{
          opacity: line2Opacity,
          transform: `translateY(${line2Y - 50}px)`,
          fontSize: 52,
          color: colors.fg,
          fontWeight: 300,
          letterSpacing: '-0.01em',
          textAlign: 'center',
        }}
      >
        This is{' '}
        <span
          style={{
            color: interpolate(highlightOpacity, [0, 1], [0, 1]) > 0.5
              ? colors.primary
              : colors.fg,
            fontWeight: 600,
            transition: 'color 0.3s',
          }}
        >
          AI memory
        </span>{' '}
        that knows the user.
      </div>

      {/* Divider */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
          marginTop: -10,
          transform: 'translateY(10px)',
          opacity: wordmarkOpacity,
        }}
      />

      {/* SQUIRE wordmark */}
      <div
        style={{
          opacity: wordmarkOpacity,
          transform: `translateY(30px) scale(${wordmarkScale})`,
          position: 'relative',
        }}
      >
        {/* Glow behind */}
        <div
          style={{
            position: 'absolute',
            width: 400,
            height: 100,
            background: `radial-gradient(ellipse, ${colors.primary}${Math.round(glowPulse * 255).toString(16).padStart(2, '0')}, transparent)`,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            filter: 'blur(30px)',
          }}
        />
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            color: colors.fg,
            letterSpacing: '0.15em',
            position: 'relative',
          }}
        >
          SQUIRE
        </div>
      </div>
    </AbsoluteFill>
  );
};
