import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const graphTraversal = [
  {x: 960, y: 320, label: 'Birthday', color: colors.primary, delay: 50},
  {x: 720, y: 460, label: 'Party', color: colors.olive, delay: 60},
  {x: 1200, y: 460, label: 'Dinner', color: colors.mustard, delay: 70},
  {x: 580, y: 600, label: 'Friends', color: colors.burntOrange, delay: 80},
  {x: 960, y: 600, label: 'Gifts', color: colors.burgundy, delay: 85},
  {x: 1340, y: 600, label: 'Surprise', color: colors.info, delay: 90},
];

const traversalEdges = [
  [0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [2, 5],
];

export const Scene03StoryEngine: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const queryOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const narrativeOpacity = interpolate(frame, [130, 160], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const narrativeWidth = interpolate(frame, [130, 210], [0, 100], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const taglineOpacity = interpolate(frame, [170, 200], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans}}>
      <div style={{position: 'absolute', top: 35, width: '100%', textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 52, fontWeight: 700, color: colors.primary}}>Story Engine</div>
        <div style={{fontSize: 26, color: colors.fgMuted, marginTop: 12}}>"Generate Not Retrieve"</div>
      </div>

      <div style={{
        position: 'absolute', top: 190, left: '50%', transform: 'translateX(-50%)',
        opacity: queryOpacity, background: colors.bgTertiary, border: `1px solid ${colors.primary}44`,
        borderRadius: 20, padding: '16px 36px', fontSize: 26, color: colors.fg,
      }}>
        "What happened on my birthday last year?"
      </div>

      <svg style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
        {traversalEdges.map(([a, b], i) => {
          const nA = graphTraversal[a], nB = graphTraversal[b];
          const delay = Math.max(nA.delay, nB.delay);
          const len = Math.sqrt((nB.x - nA.x) ** 2 + (nB.y - nA.y) ** 2);
          const offset = interpolate(frame, [delay, delay + 20], [len, 0], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
          });
          return (
            <line key={i} x1={nA.x} y1={nA.y} x2={nB.x} y2={nB.y}
              stroke={colors.primary} strokeWidth={3} strokeDasharray={len}
              strokeDashoffset={offset} opacity={0.5} strokeLinecap="round" />
          );
        })}
      </svg>

      {graphTraversal.map((node, i) => {
        const scale = spring({frame: frame - node.delay, fps, config: {damping: 12, stiffness: 120, mass: 0.4}});
        const pulseFrame = frame - node.delay - 10;
        const pulse = pulseFrame > 0 ? interpolate(Math.sin(pulseFrame * 0.1), [-1, 1], [0.2, 0.5]) : 0;
        const size = 60;
        return (
          <div key={i} style={{
            position: 'absolute', left: node.x - size / 2, top: node.y - size / 2,
            transform: `scale(${scale})`, display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <div style={{
              position: 'absolute', width: size * 2.5, height: size * 2.5, borderRadius: '50%',
              background: `radial-gradient(circle, ${node.color}44, transparent)`,
              opacity: pulse, left: -(size * 0.75), top: -(size * 0.75),
            }} />
            <div style={{
              width: size, height: size, borderRadius: '50%',
              background: `radial-gradient(circle at 35% 35%, ${node.color}, ${node.color}88)`,
              border: `3px solid ${node.color}`, boxShadow: `0 0 20px ${node.color}44`,
            }} />
            <div style={{marginTop: 10, fontSize: 18, color: colors.cream, fontWeight: 600}}>{node.label}</div>
          </div>
        );
      })}

      <div style={{
        position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)',
        opacity: narrativeOpacity, width: 900,
      }}>
        <div style={{
          background: colors.bgSecondary, border: `1px solid ${colors.primary}33`,
          borderRadius: 20, padding: '24px 36px', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{fontSize: 20, color: colors.fg, lineHeight: 1.6}}>
            <span style={{color: colors.primary, fontWeight: 700}}>Narrative: </span>
            Last year you celebrated your birthday with close friends at the Italian
            restaurant downtown. Sarah organized a surprise, and everyone contributed
            to a gift you'd mentioned wanting...
          </div>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, height: 4, width: `${narrativeWidth}%`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.mustard})`, borderRadius: '0 3px 0 0',
          }} />
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 50, width: '100%', textAlign: 'center',
        opacity: taglineOpacity, fontSize: 28, color: colors.mustard, fontWeight: 700, letterSpacing: '0.08em',
      }}>
        STORIES, NOT SEARCH RESULTS
      </div>
    </AbsoluteFill>
  );
};
