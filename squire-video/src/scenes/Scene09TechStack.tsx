import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const routerTiers = [
  {label: 'Smart Tier', models: ['Claude Sonnet 4.5', 'Grok'], color: colors.primary, desc: 'Complex reasoning'},
  {label: 'Fast Tier', models: ['Groq', 'Gemini', 'xAI'], color: colors.mustard, desc: 'Search & retrieval'},
  {label: 'Local Tier', models: ['Ollama (Qwen 2.5)'], color: colors.olive, desc: 'Privacy-first filtering'},
];

const stackLayers = [
  {label: 'TypeScript + Node.js', color: colors.primary, width: 580},
  {label: 'PostgreSQL + pgvector', color: colors.olive, width: 510},
  {label: 'Next.js + React', color: colors.mustard, width: 440},
  {label: 'Express + Socket.IO', color: colors.burntOrange, width: 370},
  {label: 'Telegram + Google Calendar', color: colors.info, width: 300},
];

export const Scene09TechStack: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans}}>
      <div style={{position: 'absolute', top: 50, width: '100%', textAlign: 'center', opacity: titleOpacity}}>
        <div style={{fontSize: 52, fontWeight: 700, color: colors.info}}>Multi-Provider Architecture</div>
      </div>

      {/* LEFT: LLM Router */}
      <div style={{position: 'absolute', left: 120, top: 160}}>
        <div style={{
          opacity: interpolate(frame, [10, 25], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          fontSize: 24, fontWeight: 700, color: colors.cream, marginBottom: 24, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>LLM Router</div>

        <div style={{
          opacity: interpolate(frame, [20, 35], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          background: colors.bgTertiary, border: `1px solid ${colors.fgMuted}33`, borderRadius: 16,
          padding: '16px 28px', fontSize: 20, color: colors.fg, marginBottom: 20, width: 440, textAlign: 'center',
        }}>{'\u{1F9ED}'} Task Classification</div>

        {routerTiers.map((tier, i) => {
          const delay = 35 + i * 18;
          const scale = spring({frame: frame - delay, fps, config: {damping: 14, stiffness: 100, mass: 0.4}});
          return (
            <div key={tier.label} style={{
              transform: `scale(${scale})`, transformOrigin: 'left center',
              background: colors.bgSecondary, border: `1.5px solid ${tier.color}44`,
              borderRadius: 18, padding: '20px 28px', marginBottom: 16, width: 440,
            }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <div>
                  <div style={{fontSize: 22, fontWeight: 700, color: tier.color}}>{tier.label}</div>
                  <div style={{fontSize: 16, color: colors.fgMuted, marginTop: 4}}>{tier.desc}</div>
                </div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 200}}>
                  {tier.models.map((m) => (
                    <div key={m} style={{
                      fontSize: 14, padding: '5px 12px', background: `${tier.color}15`,
                      border: `1px solid ${tier.color}33`, borderRadius: 8, color: tier.color, fontWeight: 600,
                    }}>{m}</div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* RIGHT: Tech Stack pyramid */}
      <div style={{
        position: 'absolute', right: 120, top: 160,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          opacity: interpolate(frame, [20, 35], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          fontSize: 24, fontWeight: 700, color: colors.cream, marginBottom: 16, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>Tech Stack</div>

        {stackLayers.map((layer, i) => {
          const delay = 40 + i * 12;
          const scale = spring({frame: frame - delay, fps, config: {damping: 14, stiffness: 100, mass: 0.4}});
          return (
            <div key={layer.label} style={{
              transform: `scale(${scale})`, transformOrigin: 'center center',
              width: layer.width, background: `linear-gradient(90deg, ${layer.color}22, ${layer.color}11)`,
              border: `1.5px solid ${layer.color}44`, borderRadius: 16, padding: '18px 0',
              textAlign: 'center', fontSize: 20, fontWeight: 700, color: layer.color,
            }}>{layer.label}</div>
          );
        })}
      </div>

      <div style={{
        position: 'absolute', bottom: 55, width: '100%', textAlign: 'center',
        opacity: interpolate(frame, [130, 155], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
        fontSize: 22, color: colors.fgMuted,
      }}>
        Local-first architecture {'\u2022'} AI-agnostic memory layer {'\u2022'} Single human design
      </div>
    </AbsoluteFill>
  );
};
