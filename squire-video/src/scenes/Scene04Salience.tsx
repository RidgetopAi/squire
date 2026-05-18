import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const factors = [
  {label: 'Temporal', weight: '20%', icon: '\u23F0', color: colors.primary},
  {label: 'Relationships', weight: '20%', icon: '\u{1F465}', color: colors.olive},
  {label: 'Action', weight: '20%', icon: '\u26A1', color: colors.mustard},
  {label: 'Explicit', weight: '15%', icon: '\u2B50', color: colors.burntOrange},
  {label: 'Self-Ref', weight: '15%', icon: '\u{1F6E1}', color: colors.burgundy},
  {label: 'Complexity', weight: '10%', icon: '\u{1F9E9}', color: colors.info},
];

const memories = [
  {x: 960, y: 490, salience: 0.95, label: 'Promotion'},
  {x: 720, y: 430, salience: 0.85, label: 'Sarah\'s news'},
  {x: 1200, y: 410, salience: 0.7, label: 'Project plan'},
  {x: 800, y: 610, salience: 0.5, label: 'Lunch order'},
  {x: 1100, y: 630, salience: 0.3, label: 'Weather chat'},
  {x: 640, y: 550, salience: 0.15, label: 'Ad seen'},
  {x: 1300, y: 530, salience: 0.6, label: 'Meeting notes'},
];

export const Scene04Salience: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans}}>
      <div style={{position: 'absolute', top: 35, width: '100%', textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 52, fontWeight: 700, color: colors.primary}}>Not All Memories Are Equal</div>
        <div style={{fontSize: 26, color: colors.fgMuted, marginTop: 12}}>Salience Scoring: 6 Weighted Factors</div>
      </div>

      <div style={{position: 'absolute', top: 200, width: '100%', display: 'flex', justifyContent: 'center', gap: 20}}>
        {factors.map((f, i) => {
          const delay = 15 + i * 10;
          const opacity = interpolate(frame, [delay, delay + 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const y = interpolate(frame, [delay, delay + 15], [12, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
          return (
            <div key={f.label} style={{
              opacity, transform: `translateY(${y}px)`, background: colors.bgTertiary,
              border: `1px solid ${f.color}44`, borderRadius: 16, padding: '14px 20px', textAlign: 'center', minWidth: 140,
            }}>
              <div style={{fontSize: 30}}>{f.icon}</div>
              <div style={{fontSize: 18, color: colors.fg, fontWeight: 700, marginTop: 6}}>{f.label}</div>
              <div style={{fontSize: 17, color: f.color, fontWeight: 700, marginTop: 4}}>{f.weight}</div>
            </div>
          );
        })}
      </div>

      {memories.map((mem, i) => {
        const delay = 60 + i * 6;
        const baseSize = 30 + mem.salience * 70;
        const scale = spring({frame: frame - delay, fps, config: {damping: 12, stiffness: 100, mass: 0.5}});
        const color = mem.salience > 0.6 ? colors.primary : mem.salience > 0.3 ? colors.taupe : colors.fgMuted;
        const float = Math.sin((frame + i * 30) * 0.03) * 5;
        return (
          <div key={i} style={{
            position: 'absolute', left: mem.x - baseSize / 2, top: mem.y - baseSize / 2 + float,
            transform: `scale(${scale})`, display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            {mem.salience > 0.7 && (
              <div style={{
                position: 'absolute', width: baseSize * 2.5, height: baseSize * 2.5, borderRadius: '50%',
                background: `radial-gradient(circle, ${colors.primary}33, transparent)`,
                left: -(baseSize * 0.75), top: -(baseSize * 0.75),
              }} />
            )}
            <div style={{
              width: baseSize, height: baseSize, borderRadius: '50%',
              background: `radial-gradient(circle at 35% 35%, ${color}cc, ${color}55)`,
              border: `2px solid ${color}66`, opacity: 0.3 + mem.salience * 0.7,
            }} />
            <div style={{
              marginTop: 10, fontSize: 16, whiteSpace: 'nowrap',
              color: mem.salience > 0.5 ? colors.cream : colors.fgMuted,
              fontWeight: mem.salience > 0.7 ? 700 : 400,
            }}>{mem.label}</div>
          </div>
        );
      })}

      <div style={{
        position: 'absolute', bottom: 60, width: '100%', textAlign: 'center',
        opacity: interpolate(frame, [140, 165], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        fontSize: 26, color: colors.cream,
      }}>
        High-salience memories persist. Trivial ones fade.
      </div>
    </AbsoluteFill>
  );
};
