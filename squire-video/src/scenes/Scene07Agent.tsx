import React from 'react';
import {AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Easing} from 'remotion';
import {colors, fonts} from '../theme';

const states = [
  {label: 'Gathering', color: colors.olive},
  {label: 'Thinking', color: colors.primary},
  {label: 'Executing', color: colors.mustard},
  {label: 'Complete', color: colors.info},
];

const autonomousSystems = [
  {label: 'Commune', desc: 'Proactive outreach every 15 min', color: colors.burntOrange},
  {label: 'Goal Worker', desc: 'Pursues Squire\'s own goals', color: colors.mustard},
  {label: 'Page Agent', desc: 'Read-only research subagent', color: colors.olive},
  {label: 'Courier', desc: 'Background task runner', color: colors.info},
];

export const Scene07Agent: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // State machine cycling
  const cycleFrame = frame % 90;
  const activeState = Math.min(Math.floor(cycleFrame / 22), 3);

  // Layout constants
  const stateRowY = 260;
  const stateBoxW = 170;
  const stateBoxH = 70;
  const stateGap = 40;
  const totalStatesW = states.length * stateBoxW + (states.length - 1) * stateGap;
  const stateStartX = (1920 - totalStatesW) / 2;

  // Autonomous grid layout: 2x2 below state machine
  const autoGridTop = 520;
  const autoBoxW = 340;
  const autoBoxH = 100;
  const autoGapX = 60;
  const autoGapY = 30;
  const autoGridLeft = (1920 - (2 * autoBoxW + autoGapX)) / 2;

  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        fontFamily: fonts.sans,
      }}
    >
      {/* Title */}
      <div
        style={{
          position: 'absolute',
          top: 35,
          width: '100%',
          textAlign: 'center',
          opacity: titleOpacity,
        }}
      >
        <div style={{fontSize: 52, fontWeight: 700, color: colors.mustard, letterSpacing: '-0.02em'}}>
          Autonomous Agent Engine
        </div>
        <div style={{fontSize: 24, color: colors.fgMuted, marginTop: 10}}>
          Multi-turn tool-calling state machine with autonomous subsystems
        </div>
      </div>

      {/* State machine - horizontal flow */}
      <svg style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
        {/* Arrows between state boxes */}
        {[0, 1, 2].map((i) => {
          const x1 = stateStartX + (i + 1) * stateBoxW + i * stateGap + 5;
          const x2 = x1 + stateGap - 10;
          const y = stateRowY + stateBoxH / 2;
          const opacity = interpolate(frame, [20 + i * 12, 30 + i * 12], [0, 0.6], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <g key={i} opacity={opacity}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke={colors.fgMuted} strokeWidth={2.5} />
              <polygon
                points={`${x2 - 2},${y - 6} ${x2 + 8},${y} ${x2 - 2},${y + 6}`}
                fill={colors.fgMuted}
              />
            </g>
          );
        })}
        {/* Loop arrow from Executing back to Gathering */}
        {(() => {
          const loopOpacity = interpolate(frame, [60, 80], [0, 0.35], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          const x1 = stateStartX + 2 * stateBoxW + 2 * stateGap + stateBoxW / 2;
          const x2 = stateStartX + stateBoxW / 2;
          const y1 = stateRowY - 2;
          const cpY = stateRowY - 70;
          return (
            <path
              d={`M ${x1} ${y1} C ${x1 + 40} ${cpY}, ${x2 - 40} ${cpY}, ${x2} ${y1}`}
              fill="none"
              stroke={colors.fgMuted}
              strokeWidth={2}
              strokeDasharray="6,6"
              opacity={loopOpacity}
              markerEnd="url(#loopArrow)"
            />
          );
        })()}
        <defs>
          <marker id="loopArrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={colors.fgMuted} opacity="0.5" />
          </marker>
        </defs>

        {/* Connecting line from state machine to autonomous grid */}
        <line
          x1={960}
          y1={stateRowY + stateBoxH + 15}
          x2={960}
          y2={autoGridTop - 15}
          stroke={colors.fgMuted}
          strokeWidth={1.5}
          strokeDasharray="4,4"
          opacity={interpolate(frame, [70, 90], [0, 0.3], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })}
        />
      </svg>

      {/* "State Machine" label */}
      <div
        style={{
          position: 'absolute',
          left: stateStartX - 10,
          top: stateRowY - 35,
          fontSize: 14,
          color: colors.fgMuted,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          opacity: interpolate(frame, [10, 25], [0, 0.6], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        Agent Loop
      </div>

      {/* State boxes */}
      {states.map((state, i) => {
        const delay = 15 + i * 12;
        const scale = spring({
          frame: frame - delay,
          fps,
          config: {damping: 14, stiffness: 100, mass: 0.4},
        });
        const isActive = i === activeState && frame > 50;
        const x = stateStartX + i * (stateBoxW + stateGap);

        return (
          <div
            key={state.label}
            style={{
              position: 'absolute',
              left: x,
              top: stateRowY,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              width: stateBoxW,
              height: stateBoxH,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                height: '100%',
                background: isActive ? `${state.color}22` : colors.bgTertiary,
                border: `2px solid ${isActive ? state.color : colors.fgMuted}44`,
                borderRadius: 16,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                boxShadow: isActive ? `0 0 25px ${state.color}33` : 'none',
              }}
            >
              {/* Active indicator dot */}
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: isActive ? state.color : colors.fgMuted,
                  boxShadow: isActive ? `0 0 10px ${state.color}` : 'none',
                }}
              />
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: isActive ? state.color : colors.fgMuted,
                }}
              >
                {state.label}
              </div>
            </div>
          </div>
        );
      })}

      {/* "Autonomous Subsystems" label */}
      <div
        style={{
          position: 'absolute',
          left: autoGridLeft,
          top: autoGridTop - 35,
          fontSize: 14,
          color: colors.fgMuted,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          opacity: interpolate(frame, [70, 90], [0, 0.6], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        Autonomous Subsystems
      </div>

      {/* Autonomous systems - 2x2 grid */}
      {autonomousSystems.map((sys, i) => {
        const delay = 80 + i * 15;
        const scale = spring({
          frame: frame - delay,
          fps,
          config: {damping: 12, stiffness: 80, mass: 0.5},
        });

        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = autoGridLeft + col * (autoBoxW + autoGapX);
        const y = autoGridTop + row * (autoBoxH + autoGapY);

        // Pulse
        const pulse = interpolate(
          Math.sin((frame + i * 20) * 0.06),
          [-1, 1],
          [0.5, 1],
        );

        return (
          <div
            key={sys.label}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              width: autoBoxW,
              height: autoBoxH,
            }}
          >
            <div
              style={{
                height: '100%',
                background: colors.bgSecondary,
                border: `1.5px solid ${sys.color}55`,
                borderRadius: 16,
                padding: '0 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                boxShadow: `0 0 ${14 * pulse}px ${sys.color}22`,
              }}
            >
              {/* Color dot */}
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: sys.color,
                  boxShadow: `0 0 8px ${sys.color}66`,
                  flexShrink: 0,
                }}
              />
              <div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: sys.color,
                  }}
                >
                  {sys.label}
                </div>
                <div
                  style={{
                    fontSize: 15,
                    color: colors.fgMuted,
                    lineHeight: 1.4,
                    marginTop: 2,
                  }}
                >
                  {sys.desc}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Qwen 2.5 badge */}
      <div
        style={{
          position: 'absolute',
          bottom: 55,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: interpolate(frame, [170, 195], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <div
          style={{
            background: colors.bgTertiary,
            border: `1px solid ${colors.burgundy}55`,
            borderRadius: 14,
            padding: '14px 28px',
            fontSize: 18,
            color: colors.cream,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{fontSize: 22}}>{'\u{1F9F2}'}</span>
          <span>
            <span style={{color: colors.burgundy, fontWeight: 700}}>Qwen 2.5</span>
            {' '}local model filters memories via Ollama
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
