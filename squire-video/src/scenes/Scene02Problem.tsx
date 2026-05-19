import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const questions = [
  'Who is Sarah?',
  'What did I decide?',
  'When was that meeting?',
  'My priorities?',
];

export const Scene02Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const dividerHeight = interpolate(frame, [15, 40], [0, 500], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const leftLabelOpacity = interpolate(frame, [25, 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const rightLabelOpacity = interpolate(frame, [35, 50], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const questionPositions = [
    {x: 100, y: 270, rot: -12},
    {x: 500, y: 280, rot: 18},
    {x: 550, y: 420, rot: -8},
    {x: 200, y: 580, rot: 5},
    {x: 500, y: 600, rot: -20},
    {x: 350, y: 690, rot: 8},
  ];

  const graphNodes = [
    {x: 1300, y: 380, label: 'You', color: colors.primary, size: 80},
    {x: 1520, y: 280, label: 'Sarah', color: colors.olive, size: 65},
    {x: 1140, y: 520, label: 'Project', color: colors.mustard, size: 65},
    {x: 1520, y: 520, label: 'Decision', color: colors.burntOrange, size: 60},
    {x: 1680, y: 400, label: 'Goals', color: colors.burgundy, size: 60},
  ];

  const graphEdges = [
    [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 3],
  ];

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans}}>
      {/* Center divider */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 2,
          height: dividerHeight,
          background: `linear-gradient(180deg, transparent, ${colors.fgMuted}44, transparent)`,
        }}
      />

      {/* LEFT: Traditional AI */}
      <div style={{position: 'absolute', left: 140, top: 140, opacity: leftLabelOpacity}}>
        <div style={{fontSize: 40, color: colors.fgMuted, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase'}}>
          Traditional AI
        </div>
        <div style={{fontSize: 24, color: colors.error, marginTop: 12, fontWeight: 500}}>
          Every conversation starts from zero
        </div>
      </div>

      {/* Scattered question marks */}
      {questionPositions.map((pos, i) => {
        const delay = 30 + i * 8;
        const opacity = interpolate(frame, [delay, delay + 15], [0, 0.6], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const float = Math.sin((frame + i * 20) * 0.04) * 6;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y + float,
              opacity,
              transform: `rotate(${pos.rot}deg)`,
              fontSize: 56,
              color: colors.fgMuted,
              fontWeight: 300,
              zIndex: 0,
            }}
          >
            ?
          </div>
        );
      })}

      {/* Question bubbles */}
      {questions.map((q, i) => {
        const delay = 40 + i * 12;
        const opacity = interpolate(frame, [delay, delay + 20], [0, 0.85], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const y = interpolate(frame, [delay, delay + 20], [10, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        });
        return (
          <div
            key={q}
            style={{
              position: 'absolute',
              left: 120 + (i % 2) * 300,
              top: 340 + Math.floor(i / 2) * 150 + y,
              zIndex: 1,
              opacity,
              background: colors.bgTertiary,
              border: `1px solid ${colors.fgMuted}33`,
              borderRadius: 16,
              padding: '14px 24px',
              fontSize: 22,
              color: colors.fgMuted,
            }}
          >
            {q}
          </div>
        );
      })}

      {/* RIGHT: Squire */}
      <div style={{position: 'absolute', right: 140, top: 140, textAlign: 'right', opacity: rightLabelOpacity}}>
        <div style={{fontSize: 40, color: colors.primary, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase'}}>
          Squire
        </div>
        <div style={{fontSize: 24, color: colors.olive, marginTop: 12, fontWeight: 500}}>
          Persistent memory graph
        </div>
      </div>

      {/* Graph edges */}
      <svg style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
        {graphEdges.map(([a, b], i) => {
          const delay = 50 + i * 6;
          const length = Math.sqrt(
            (graphNodes[b].x - graphNodes[a].x) ** 2 + (graphNodes[b].y - graphNodes[a].y) ** 2
          );
          const dashOffset = interpolate(frame, [delay, delay + 20], [length, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          return (
            <line key={i} x1={graphNodes[a].x} y1={graphNodes[a].y} x2={graphNodes[b].x} y2={graphNodes[b].y}
              stroke={colors.fgMuted} strokeWidth={2.5} strokeDasharray={length} strokeDashoffset={dashOffset} opacity={0.35} />
          );
        })}
      </svg>

      {/* Graph nodes */}
      {graphNodes.map((node, i) => {
        const delay = 45 + i * 8;
        const scale = spring({frame: frame - delay, fps, config: {damping: 12, stiffness: 100, mass: 0.5}});
        return (
          <div key={i} style={{
            position: 'absolute',
            left: node.x - node.size / 2,
            top: node.y - node.size / 2,
            transform: `scale(${scale})`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            <div style={{
              width: node.size,
              height: node.size,
              borderRadius: '50%',
              background: `radial-gradient(circle at 35% 35%, ${node.color}, ${node.color}88)`,
              border: `3px solid ${node.color}`,
              boxShadow: `0 0 24px ${node.color}44`,
            }} />
            <div style={{marginTop: 10, fontSize: 20, color: colors.cream, fontWeight: 600}}>
              {node.label}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
