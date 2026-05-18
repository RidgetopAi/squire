import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const beliefTypes = [
  {label: 'Values', example: '"Honesty over diplomacy"', color: colors.burgundy, icon: '\u{1F3AF}'},
  {label: 'Preferences', example: '"Morning meetings"', color: colors.mustard, icon: '\u2699\uFE0F'},
  {label: 'Self-Knowledge', example: '"Works best under pressure"', color: colors.olive, icon: '\u{1F9E0}'},
  {label: 'Predictions', example: '"This project will succeed"', color: colors.burntOrange, icon: '\u{1F52E}'},
];

export const Scene05Beliefs: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const evidenceOpacity = interpolate(frame, [120, 145], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans}}>
      <div style={{position: 'absolute', top: 35, width: '100%', textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 52, fontWeight: 700, color: colors.burgundy}}>Belief Extraction</div>
        <div style={{fontSize: 26, color: colors.fgMuted, marginTop: 12}}>Understanding what you believe, value, and predict</div>
      </div>

      {/* Belief cards - centered 2x2 grid */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 40,
      }}>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, width: 1100}}>
        {beliefTypes.map((bt, i) => {
          const delay = 30 + i * 15;
          const scale = spring({frame: frame - delay, fps, config: {damping: 14, stiffness: 100, mass: 0.4}});
          return (
            <div key={bt.label} style={{transform: `scale(${scale})`, transformOrigin: 'center center'}}>
              <div style={{
                background: colors.bgSecondary, border: `2px solid ${bt.color}44`,
                borderRadius: 20, padding: '28px 32px', display: 'flex', alignItems: 'center', gap: 24,
              }}>
                <div style={{fontSize: 44, flexShrink: 0}}>{bt.icon}</div>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 26, fontWeight: 700, color: bt.color}}>{bt.label}</div>
                  <div style={{fontSize: 20, color: colors.fgMuted, marginTop: 6, fontStyle: 'italic'}}>{bt.example}</div>
                </div>
                {/* Confidence bar */}
                <div style={{width: 80, height: 8, background: colors.bgTertiary, borderRadius: 4, overflow: 'hidden', flexShrink: 0}}>
                  <div style={{
                    width: `${interpolate(frame, [delay + 10, delay + 35], [0, 70 + i * 8], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}%`,
                    height: '100%', background: bt.color, borderRadius: 4,
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {/* Evidence & Conflict callouts */}
      <div style={{
        position: 'absolute', bottom: 100, left: '50%', transform: 'translateX(-50%)',
        opacity: evidenceOpacity, display: 'flex', gap: 40,
      }}>
        <div style={{
          background: colors.bgTertiary, border: `1px solid ${colors.olive}44`,
          borderRadius: 14, padding: '16px 28px', fontSize: 20, color: colors.olive,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{fontSize: 26}}>{'\u{1F517}'}</span> Evidence chains track sources
        </div>
        <div style={{
          background: colors.bgTertiary, border: `1px solid ${colors.warning}44`,
          borderRadius: 14, padding: '16px 28px', fontSize: 20, color: colors.warning,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{fontSize: 26}}>{'\u26A0\uFE0F'}</span> Conflict detection when beliefs contradict
        </div>
      </div>
    </AbsoluteFill>
  );
};
