import React from 'react';
import {useCurrentFrame, interpolate, Easing} from 'remotion';
import {colors, fonts} from '../theme';

interface FadeTextProps {
  text: string;
  startFrame?: number;
  duration?: number;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontFamily?: string;
  y?: number;
  delay?: number;
  style?: React.CSSProperties;
}

export const FadeText: React.FC<FadeTextProps> = ({
  text,
  startFrame = 0,
  duration = 30,
  fontSize = 48,
  color = colors.fg,
  fontWeight = 400,
  fontFamily = fonts.sans,
  y = 0,
  delay = 0,
  style = {},
}) => {
  const frame = useCurrentFrame();
  const f = frame - startFrame - delay;

  const opacity = interpolate(f, [0, duration * 0.4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const translateY = interpolate(f, [0, duration * 0.5], [18, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY + y}px)`,
        fontSize,
        color,
        fontWeight,
        fontFamily,
        textAlign: 'center',
        lineHeight: 1.3,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
