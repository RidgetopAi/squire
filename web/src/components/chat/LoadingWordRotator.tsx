'use client';

import { useState, useEffect, useMemo } from 'react';

/**
 * ✨ EDIT THIS LIST to add/remove/change loading phrases ✨
 */
const LOADING_PHRASES = [
  'Migrating Coconuts',
  'Hee Hawing',
  "Put'em in the Bucket",
  'Hobnobbing',
  'Spindeling',
];

/** Duration each phrase is displayed (ms) */
const PHRASE_DURATION = 2400;
/** Stagger delay between each letter starting its shimmer (ms) */
const LETTER_STAGGER = 45;

export function LoadingWordRotator() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * LOADING_PHRASES.length));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Fade-out → swap → fade-in cycle
    const interval = setInterval(() => {
      setVisible(false); // start fade out
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
        setVisible(true); // fade in new word
      }, 350); // matches CSS transition duration
    }, PHRASE_DURATION);

    return () => clearInterval(interval);
  }, []);

  const phrase = LOADING_PHRASES[index];

  // Memoize the shimmer CSS so it's only injected once
  const shimmerStyle = useMemo(
    () => (
      <style jsx global>{`
        @keyframes shimmer-sweep {
          0% {
            background-position: -200% center;
          }
          100% {
            background-position: 200% center;
          }
        }

        .shimmer-letter {
          display: inline-block;
          background: linear-gradient(
            90deg,
            var(--foreground-muted) 0%,
            var(--foreground-muted) 35%,
            var(--primary) 48%,
            var(--accent-mustard) 52%,
            var(--foreground-muted) 65%,
            var(--foreground-muted) 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer-sweep 2s ease-in-out infinite;
        }
      `}</style>
    ),
    []
  );

  return (
    <div className="flex items-center gap-2 select-none" aria-live="polite" aria-label="Loading">
      {shimmerStyle}

      {/* Small pulsing dot */}
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
        style={{ boxShadow: '0 0 6px var(--primary-glow)' }}
      />

      {/* Rotating phrase with per-letter shimmer */}
      <span
        className={`
          text-sm font-medium tracking-wide transition-all duration-300 ease-in-out
          ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'}
        `}
      >
        {phrase.split('').map((char, i) => (
          <span
            key={`${index}-${i}`}
            className="shimmer-letter"
            style={{ animationDelay: `${i * LETTER_STAGGER}ms` }}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </span>
    </div>
  );
}
