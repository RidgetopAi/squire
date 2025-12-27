'use client';

import { useState, useRef, useEffect, KeyboardEvent, useCallback } from 'react';
import { STTButton } from './STTButton';

interface ChatInputBarProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function ChatInputBar({
  onSend,
  isLoading = false,
  placeholder = 'Type a message...',
}: ChatInputBarProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (trimmed && !isLoading) {
      onSend(trimmed);
      setInput('');
      // Reset height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle speech-to-text transcript
  const handleSpeechTranscript = useCallback((text: string) => {
    setInput((prev) => {
      // Add space if there's existing text
      const newText = prev ? `${prev} ${text}` : text;
      return newText;
    });
    // Focus the textarea after speech input
    textareaRef.current?.focus();
  }, []);

  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <div className="border-t border-glass-border bg-background-secondary p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end gap-3">
          {/* Speech-to-text button */}
          <STTButton
            onTranscript={handleSpeechTranscript}
            disabled={isLoading}
          />

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              className="
                w-full px-4 py-3 rounded-xl resize-none
                bg-background-tertiary border border-glass-border
                text-foreground placeholder-foreground-muted
                focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
              style={{ maxHeight: '200px' }}
            />
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend}
            className={`
              shrink-0 p-3 rounded-xl transition-all duration-200
              ${canSend
                ? 'bg-primary text-background hover:bg-primary-hover glow-primary'
                : 'bg-background-tertiary text-foreground-muted border border-glass-border'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isLoading ? (
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Helper text */}
        <p className="text-xs text-foreground-muted mt-2 text-center">
          Press <kbd className="px-1.5 py-0.5 rounded bg-background-tertiary text-foreground-muted">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 rounded bg-background-tertiary text-foreground-muted">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}
