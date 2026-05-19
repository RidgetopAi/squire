import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const toolCategories = [
  {label: 'Time', icon: '\u23F0', color: colors.primary, wave: 0},
  {label: 'Notes', icon: '\u{1F4DD}', color: colors.olive, wave: 0},
  {label: 'Lists', icon: '\u{1F4CB}', color: colors.mustard, wave: 0},
  {label: 'Memory', icon: '\u{1F9E0}', color: colors.burgundy, wave: 0},
  {label: 'Calendar', icon: '\u{1F4C5}', color: colors.info, wave: 0},
  {label: 'Commitments', icon: '\u{1F91D}', color: colors.burntOrange, wave: 0},
  {label: 'Reminders', icon: '\u{1F514}', color: colors.mustard, wave: 1},
  {label: 'Email', icon: '\u{1F4E7}', color: colors.primary, wave: 1},
  {label: 'Bash', icon: '\u{1F4BB}', color: colors.olive, wave: 1},
  {label: 'Edit', icon: '\u270F\uFE0F', color: colors.cream, wave: 1},
  {label: 'Git', icon: '\u{1F500}', color: colors.burntOrange, wave: 1},
  {label: 'Search', icon: '\u{1F50D}', color: colors.info, wave: 1},
  {label: 'Steward', icon: '\u{1F6E1}\uFE0F', color: colors.primary, wave: 2},
  {label: 'Commune', icon: '\u{1F4E2}', color: colors.mustard, wave: 2},
  {label: 'Goals', icon: '\u{1F3AF}', color: colors.burgundy, wave: 2},
  {label: 'Images', icon: '\u{1F5BC}\uFE0F', color: colors.olive, wave: 2},
  {label: 'Page', icon: '\u{1F4D6}', color: colors.info, wave: 2},
  {label: 'Mandrel', icon: '\u{1F517}', color: colors.burntOrange, wave: 2},
];

export const Scene08Tools: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const cols = 6;
  const cellW = 200;
  const cellH = 140;
  const gridLeft = (1920 - cols * cellW) / 2 + 10;
  const gridTop = 220;

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans}}>
      <div style={{position: 'absolute', top: 50, width: '100%', textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 52, fontWeight: 700, color: colors.burntOrange}}>18 Tool Categories</div>
        <div style={{fontSize: 26, color: colors.fgMuted, marginTop: 10}}>Full autonomy over the user's digital life</div>
      </div>

      {toolCategories.map((tool, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const waveDelay = tool.wave * 20;
        const itemDelay = 20 + waveDelay + (i % cols) * 4;
        const scale = spring({frame: frame - itemDelay, fps, config: {damping: 12, stiffness: 100, mass: 0.4}});
        const x = gridLeft + col * cellW;
        const y = gridTop + row * cellH;

        return (
          <div key={tool.label} style={{
            position: 'absolute', left: x, top: y, width: cellW - 16, height: cellH - 16,
            transform: `scale(${scale})`, transformOrigin: 'center center',
            background: colors.bgSecondary, border: `1.5px solid ${tool.color}33`,
            borderRadius: 18, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <div style={{fontSize: 36}}>{tool.icon}</div>
            <div style={{fontSize: 18, fontWeight: 700, color: tool.color, letterSpacing: '0.02em'}}>
              {tool.label}
            </div>
          </div>
        );
      })}

      <div style={{
        position: 'absolute', bottom: 60, width: '100%', display: 'flex', justifyContent: 'center', gap: 40,
        opacity: interpolate(frame, [140, 165], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
      }}>
        {[
          {text: 'Claude Code Integration', color: colors.primary},
          {text: 'Mandrel Shared Memory', color: colors.burntOrange},
          {text: 'Email Send/Read/Search', color: colors.mustard},
        ].map((item) => (
          <div key={item.text} style={{
            fontSize: 18, color: item.color, fontWeight: 600, padding: '10px 20px',
            background: `${item.color}11`, border: `1px solid ${item.color}33`, borderRadius: 12,
          }}>
            {item.text}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
