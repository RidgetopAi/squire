import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const nodes = Array.from({length: 12}, (_, i) => ({
  x: 300 + (i % 4) * 380 + (Math.sin(i * 2.1) * 40),
  y: 360 + Math.floor(i / 4) * 180 + (Math.cos(i * 1.7) * 30),
  salience: [0.9, 0.3, 0.7, 0.15, 0.8, 0.2, 0.6, 0.1, 0.85, 0.4, 0.55, 0.05][i],
}));

const edges = [
  [0, 4], [0, 2], [1, 5], [2, 6], [4, 8], [6, 10],
  [8, 9], [3, 7], [0, 9], [2, 10],
];

const phases = [
  {label: 'DECAY', color: colors.fgMuted, frames: [0, 60] as const},
  {label: 'STRENGTHEN', color: colors.primary, frames: [50, 110] as const},
  {label: 'CONNECT', color: colors.olive, frames: [90, 150] as const},
  {label: 'PATTERN', color: colors.mustard, frames: [130, 180] as const},
  {label: 'INSIGHT', color: colors.burntOrange, frames: [160, 210] as const},
];

export const Scene06Consolidation: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const currentPhaseIdx = phases.findIndex(p => frame >= p.frames[0] && frame < p.frames[1]);

  return (
    <AbsoluteFill style={{
      background: `linear-gradient(180deg, ${colors.bg} 0%, #15130f ${interpolate(frame, [0, 40], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}%)`,
      fontFamily: fonts.sans,
    }}>
      <div style={{position: 'absolute', top: 30, width: '100%', textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 52, fontWeight: 700, color: colors.olive}}>Memory Consolidation</div>
        <div style={{fontSize: 26, color: colors.fgMuted, marginTop: 12}}>Like human sleep: important things persist, connections form</div>
      </div>

      {/* Phase labels */}
      <div style={{position: 'absolute', top: 180, width: '100%', display: 'flex', justifyContent: 'center', gap: 28}}>
        {phases.map((p, i) => {
          const active = i === currentPhaseIdx;
          const opacity = interpolate(frame, [p.frames[0] - 10, p.frames[0]], [0.3, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          return (
            <div key={p.label} style={{
              opacity, fontSize: 18, fontWeight: active ? 700 : 500, letterSpacing: '0.08em',
              color: active ? p.color : `${p.color}88`, padding: '10px 20px', borderRadius: 12,
              border: active ? `2px solid ${p.color}66` : '2px solid transparent',
              background: active ? `${p.color}11` : 'transparent',
            }}>
              {p.label}
            </div>
          );
        })}
      </div>

      {/* Edges */}
      <svg style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
        {edges.map(([a, b], i) => {
          const connectDelay = 95 + i * 4;
          const len = Math.sqrt((nodes[b].x - nodes[a].x) ** 2 + (nodes[b].y - nodes[a].y) ** 2);
          const offset = interpolate(frame, [connectDelay, connectDelay + 20], [len, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
          });
          const edgeOpacity = interpolate(frame, [connectDelay - 5, connectDelay + 5], [0, 0.4], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          });
          return (
            <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
              stroke={colors.olive} strokeWidth={2.5} strokeDasharray={len}
              strokeDashoffset={offset} opacity={edgeOpacity} strokeLinecap="round" />
          );
        })}
      </svg>

      {/* Memory nodes */}
      {nodes.map((node, i) => {
        const baseSize = 22 + node.salience * 40;
        const decayScale = node.salience < 0.3
          ? interpolate(frame, [20 + i * 2, 50 + i * 2], [1, 0.3], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
          : 1;
        const strengthenScale = node.salience > 0.6
          ? interpolate(frame, [60, 100], [1, 1.4], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)})
          : 1;
        const finalScale = decayScale * strengthenScale;
        const nodeColor = node.salience > 0.6 ? colors.primary : node.salience > 0.3 ? colors.taupe : colors.fgMuted;
        const glowing = node.salience > 0.7 && frame > 70;
        const glowOpacity = glowing ? interpolate(Math.sin(frame * 0.08 + i), [-1, 1], [0.15, 0.4]) : 0;

        return (
          <div key={i} style={{
            position: 'absolute', left: node.x - baseSize / 2, top: node.y - baseSize / 2,
            transform: `scale(${finalScale})`,
          }}>
            {glowing && (
              <div style={{
                position: 'absolute', width: baseSize * 3, height: baseSize * 3, borderRadius: '50%',
                background: `radial-gradient(circle, ${colors.primary}33, transparent)`,
                opacity: glowOpacity, left: -baseSize, top: -baseSize,
              }} />
            )}
            <div style={{
              width: baseSize, height: baseSize, borderRadius: '50%',
              background: `radial-gradient(circle at 35% 35%, ${nodeColor}cc, ${nodeColor}55)`,
              border: `2px solid ${nodeColor}66`, opacity: 0.4 + node.salience * 0.6,
            }} />
          </div>
        );
      })}

      {frame > 165 && (
        <div style={{
          position: 'absolute', left: 960 - 40, top: 460,
          opacity: interpolate(frame, [165, 180], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: `radial-gradient(circle, ${colors.mustard}66, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 40, boxShadow: `0 0 40px ${colors.mustard}44`,
          }}>
            {'\u{1F4A1}'}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
