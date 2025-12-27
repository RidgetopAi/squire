'use client';

import { useState, useEffect } from 'react';

interface HeaderBarProps {
  onMenuToggle?: () => void;
  isSideNavOpen?: boolean;
}

export function HeaderBar({ onMenuToggle, isSideNavOpen }: HeaderBarProps) {
  const [isConnected, setIsConnected] = useState(false);

  // Simulate connection check - will be replaced with real WebSocket status
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/health');
        setIsConnected(response.ok);
      } catch {
        setIsConnected(false);
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-14 bg-background-secondary border-b border-glass-border flex items-center justify-between px-4 shrink-0">
      {/* Left: Menu button (mobile) + Logo */}
      <div className="flex items-center gap-3">
        {/* Mobile menu toggle */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-md hover:bg-background-tertiary transition-colors"
          aria-label={isSideNavOpen ? 'Close menu' : 'Open menu'}
        >
          <svg
            className="w-5 h-5 text-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {isSideNavOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-primary glow-text-primary">
            Squire
          </span>
        </div>
      </div>

      {/* Center: Reserved for breadcrumb/title */}
      <div className="hidden md:flex items-center">
        {/* Will be populated by page context later */}
      </div>

      {/* Right: Status + Profile */}
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected
                ? 'bg-success animate-pulse'
                : 'bg-error'
            }`}
            title={isConnected ? 'Connected' : 'Disconnected'}
          />
          <span className="hidden sm:inline text-xs text-foreground-muted">
            {isConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        {/* Profile placeholder */}
        <button
          className="w-8 h-8 rounded-full bg-background-tertiary border border-glass-border flex items-center justify-center hover:border-primary transition-colors"
          aria-label="Profile"
        >
          <svg
            className="w-4 h-4 text-foreground-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
