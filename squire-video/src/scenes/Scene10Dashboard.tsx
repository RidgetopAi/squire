import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const pages = [
  {
    name: 'Chat',
    content: (
      <div style={{padding: 30}}>
        <div style={{display: 'flex', justifyContent: 'flex-end', marginBottom: 24}}>
          <div style={{
            maxWidth: 480, padding: '18px 26px', borderRadius: 20,
            background: `${colors.primary}33`, border: `1px solid ${colors.primary}33`,
            fontSize: 20, color: colors.fg, lineHeight: 1.5,
          }}>What happened with the Q1 roadmap?</div>
        </div>
        <div style={{display: 'flex', justifyContent: 'flex-start', marginBottom: 24}}>
          <div style={{
            maxWidth: 520, padding: '18px 26px', borderRadius: 20,
            background: colors.bgTertiary, border: `1px solid ${colors.fgMuted}33`,
            fontSize: 20, color: colors.fg, lineHeight: 1.5,
          }}>
            Based on your conversations with Sarah last week, the Q1 roadmap focuses on three priorities: AI memory features, API stability, and...
          </div>
        </div>
        <div style={{display: 'flex', gap: 6, paddingLeft: 16}}>
          {[0, 1, 2].map((d) => (
            <div key={d} style={{width: 10, height: 10, borderRadius: '50%', background: colors.fgMuted, opacity: 0.5}} />
          ))}
        </div>
      </div>
    ),
  },
  {
    name: 'Graph',
    content: (
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: 580, padding: '20px 40px'}}>
      <svg width="700" height="400" viewBox="0 0 700 400">
        {[
          {x: 350, y: 120, r: 30, c: colors.primary, l: 'You'},
          {x: 200, y: 230, r: 24, c: colors.olive, l: 'Sarah'},
          {x: 500, y: 230, r: 24, c: colors.mustard, l: 'Project'},
          {x: 130, y: 340, r: 20, c: colors.info, l: 'Team'},
          {x: 350, y: 340, r: 20, c: colors.burntOrange, l: 'Goals'},
          {x: 570, y: 340, r: 20, c: colors.burgundy, l: 'Clients'},
        ].map((n, i) => (
          <g key={i}>
            {i > 0 && <line x1={350} y1={120} x2={n.x} y2={n.y} stroke={colors.fgMuted} strokeWidth={2} opacity={0.3} />}
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.c} opacity={0.7} />
            <text x={n.x} y={n.y + n.r + 20} fill={colors.fgMuted} fontSize={16} textAnchor="middle" fontWeight="600">{n.l}</text>
          </g>
        ))}
        <line x1={200} y1={230} x2={130} y2={340} stroke={colors.fgMuted} strokeWidth={1.5} opacity={0.25} />
        <line x1={500} y1={230} x2={570} y2={340} stroke={colors.fgMuted} strokeWidth={1.5} opacity={0.25} />
        <line x1={500} y1={230} x2={350} y2={340} stroke={colors.fgMuted} strokeWidth={1.5} opacity={0.25} />
      </svg>
      </div>
    ),
  },
  {
    name: 'Timeline',
    content: (
      <div style={{padding: '20px 40px'}}>
        {['Meeting with Sarah about roadmap', 'Completed API refactor', 'Reviewed Q1 budget', 'Call with investors', 'New hire onboarding'].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 18, marginBottom: 20,
            opacity: 0.7 + (i < 2 ? 0.3 : 0),
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
              background: [colors.primary, colors.olive, colors.mustard, colors.burntOrange, colors.info][i],
            }} />
            <div>
              <div style={{fontSize: 20, color: colors.fg, fontWeight: 600}}>{item}</div>
              <div style={{fontSize: 16, color: colors.fgMuted, marginTop: 2}}>
                {['2h ago', 'Yesterday', '3 days ago', 'Last week', '2 weeks ago'][i]}
              </div>
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

export const Scene10Dashboard: React.FC = () => {
  const frame = useCurrentFrame();

  const browserOpacity = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const pageDuration = 55;
  const currentPage = Math.min(Math.floor(frame / pageDuration), pages.length - 1);
  const pageFrame = frame - currentPage * pageDuration;
  const pageOpacity = interpolate(pageFrame, [0, 12, pageDuration - 8, pageDuration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const sidebarItems = ['Chat', 'Dashboard', 'Graph', 'Timeline', 'Notes', 'Calendar', 'Commitments'];

  return (
    <AbsoluteFill style={{background: colors.bg, fontFamily: fonts.sans, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{
        opacity: browserOpacity, width: 1400, height: 750,
        background: colors.bgSecondary, borderRadius: 20,
        border: `1px solid ${colors.fgMuted}22`, overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Title bar */}
        <div style={{
          height: 48, background: colors.bgTertiary, display: 'flex', alignItems: 'center',
          padding: '0 20px', gap: 10, borderBottom: `1px solid ${colors.fgMuted}15`,
        }}>
          <div style={{width: 14, height: 14, borderRadius: '50%', background: '#ff5f56'}} />
          <div style={{width: 14, height: 14, borderRadius: '50%', background: '#ffbd2e'}} />
          <div style={{width: 14, height: 14, borderRadius: '50%', background: '#27c93f'}} />
          <div style={{
            marginLeft: 24, flex: 1, background: colors.bg, borderRadius: 8,
            padding: '6px 16px', fontSize: 16, color: colors.fgMuted,
          }}>squire.local:3000</div>
        </div>

        <div style={{display: 'flex', flex: 1}}>
          {/* Sidebar */}
          <div style={{width: 220, background: colors.bg, borderRight: `1px solid ${colors.fgMuted}15`, padding: '16px 0'}}>
            <div style={{padding: '10px 22px 20px', fontSize: 22, fontWeight: 700, color: colors.primary, letterSpacing: '0.08em'}}>
              SQUIRE
            </div>
            {sidebarItems.map((item) => (
              <div key={item} style={{
                padding: '12px 22px', fontSize: 18,
                color: item === pages[currentPage].name ? colors.primary : colors.fgMuted,
                fontWeight: item === pages[currentPage].name ? 700 : 400,
                background: item === pages[currentPage].name ? `${colors.primary}11` : 'transparent',
                borderLeft: item === pages[currentPage].name ? `3px solid ${colors.primary}` : '3px solid transparent',
              }}>{item}</div>
            ))}
          </div>

          <div style={{flex: 1, position: 'relative', overflow: 'hidden'}}>
            <div style={{
              padding: '20px 32px', borderBottom: `1px solid ${colors.fgMuted}15`,
              fontSize: 26, fontWeight: 700, color: colors.fg,
            }}>{pages[currentPage].name}</div>
            <div style={{opacity: pageOpacity}}>{pages[currentPage].content}</div>
          </div>
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 35, width: '100%', textAlign: 'center',
        fontSize: 20, color: colors.fgMuted,
        opacity: interpolate(frame, [20, 40], [0, 0.7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
      }}>
        Next.js Web Dashboard {'\u2022'} Real-time WebSocket sync
      </div>
    </AbsoluteFill>
  );
};
