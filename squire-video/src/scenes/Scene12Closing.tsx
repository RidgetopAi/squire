import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';

export const Scene12Closing: React.FC = () => {
  const frame = useCurrentFrame();

  const wordmarkOpacity = interpolate(frame, [5, 25], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const wordmarkScale = interpolate(frame, [5, 30], [0.9, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const taglineOpacity = interpolate(frame, [20, 40], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const creditOpacity = interpolate(frame, [30, 45], [0, 0.6], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const glowPulse = interpolate(Math.sin(frame * 0.08), [-1, 1], [0.15, 0.4]);

  return (
    <AbsoluteFill style={{
      background: colors.bg, fontFamily: fonts.sans,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', width: 700, height: 250,
        background: `radial-gradient(ellipse, ${colors.primary}${Math.round(glowPulse * 255).toString(16).padStart(2, '0')}, transparent)`,
        filter: 'blur(60px)', opacity: wordmarkOpacity,
      }} />

      <div style={{
        opacity: wordmarkOpacity, transform: `scale(${wordmarkScale})`,
        fontSize: 120, fontWeight: 700, color: colors.fg, letterSpacing: '0.15em', position: 'relative', zIndex: 1,
      }}>SQUIRE</div>

      <div style={{
        width: interpolate(frame, [15, 35], [0, 250], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)}),
        height: 3, background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
        marginTop: 20, marginBottom: 20, opacity: wordmarkOpacity,
      }} />

      <div style={{
        opacity: taglineOpacity, fontSize: 32, color: colors.cream, fontWeight: 300,
        letterSpacing: '0.02em', position: 'relative', zIndex: 1,
      }}>AI memory that knows the user</div>

      <div style={{
        opacity: creditOpacity, fontSize: 20, color: colors.fgMuted,
        marginTop: 50, fontWeight: 500, position: 'relative', zIndex: 1,
      }}>Built by RidgetopAI</div>
    </AbsoluteFill>
  );
};
