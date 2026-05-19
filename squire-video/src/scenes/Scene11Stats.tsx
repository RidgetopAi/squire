import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';
import {StatCounter} from '../components/StatCounter';

const stats = [
  {target: 36000, label: 'Lines of TypeScript', color: colors.primary, delay: 10},
  {target: 32, label: 'Database Migrations', color: colors.olive, delay: 20},
  {target: 18, label: 'REST API Endpoints', suffix: '+', color: colors.mustard, delay: 30},
];

export const Scene11Stats: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{
      background: colors.bgSecondary, fontFamily: fonts.sans,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{opacity: titleOpacity, fontSize: 48, fontWeight: 700, color: colors.fg, marginBottom: 80}}>
        Built to Scale
      </div>

      <div style={{display: 'flex', gap: 140, alignItems: 'flex-start'}}>
        {stats.map((stat) => (
          <StatCounter key={stat.label} target={stat.target} label={stat.label}
            suffix={stat.suffix || ''} delay={stat.delay} color={stat.color} fontSize={88} />
        ))}
      </div>

      <div style={{
        display: 'flex', gap: 32, marginTop: 80,
        opacity: interpolate(frame, [60, 80], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
      }}>
        {['PostgreSQL + pgvector', 'Local-First', 'Single Human Design'].map((badge) => (
          <div key={badge} style={{
            padding: '12px 24px', background: colors.bgTertiary, border: `1px solid ${colors.fgMuted}33`,
            borderRadius: 14, fontSize: 20, color: colors.cream, fontWeight: 600,
          }}>{badge}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
