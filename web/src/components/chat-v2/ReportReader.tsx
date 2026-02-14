'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReportData } from '@/lib/types';

interface ReportReaderProps {
  report: ReportData;
  isOpen: boolean;
  onClose: () => void;
}

export function ReportReader({ report, isOpen, onClose }: ReportReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  // Track scroll progress
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = scrollHeight - clientHeight;
      setProgress(maxScroll > 0 ? scrollTop / maxScroll : 0);
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  const handleExportStub = (type: string) => {
    // Stub: show coming soon feedback
    console.log(`[ReportReader] Export ${type} - coming soon`);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="fixed inset-0 z-[60] bg-[var(--background)] flex flex-col"
        >
          {/* Progress bar */}
          <div className="h-0.5 bg-background-tertiary">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border)]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 bg-accent-mustard/15 text-accent-mustard border border-accent-mustard/30">
                Report
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-foreground-muted hover:text-foreground transition-colors"
              aria-label="Close report"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-8">
              {/* Title */}
              <h1 className="font-[var(--font-instrument)] text-2xl text-foreground mb-3 leading-tight">
                {report.title}
              </h1>

              {/* Summary */}
              <p className="text-sm text-foreground-muted leading-relaxed mb-8 pb-6 border-b border-[var(--card-border)]">
                {report.summary}
              </p>

              {/* Full content */}
              <div className="prose prose-invert prose-sm max-w-none text-foreground leading-relaxed
                [&_p]:mb-3
                [&_code]:text-accent-mustard [&_code]:bg-background-tertiary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs
                [&_pre]:bg-background-tertiary [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-xs
                [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                [&_strong]:text-foreground [&_strong]:font-semibold
                [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                [&_li]:mb-1.5
                [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:font-[var(--font-instrument)]
                [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-[var(--font-instrument)]
                [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2
                [&_blockquote]:border-l-2 [&_blockquote]:border-cream/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-foreground-muted
                [&_hr]:border-[var(--card-border)] [&_hr]:my-6
                [&_table]:w-full [&_table]:text-sm [&_table]:my-4
                [&_thead]:border-b [&_thead]:border-foreground-muted/20
                [&_th]:text-left [&_th]:text-foreground-muted [&_th]:font-medium [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:px-3 [&_th]:py-2
                [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-[var(--card-border)] [&_td]:text-foreground
                [&_tr:last-child_td]:border-b-0
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown>
              </div>
            </div>
          </div>

          {/* Footer with export stubs */}
          <div className="flex items-center justify-center gap-3 px-6 py-3 border-t border-[var(--card-border)]">
            <button
              onClick={() => handleExportStub('copy')}
              className="text-xs text-foreground-muted hover:text-foreground transition-colors px-3 py-1.5 border border-[var(--card-border)] hover:border-foreground-muted/30"
            >
              Copy
            </button>
            <button
              onClick={() => handleExportStub('pdf')}
              className="text-xs text-foreground-muted hover:text-foreground transition-colors px-3 py-1.5 border border-[var(--card-border)] hover:border-foreground-muted/30"
            >
              PDF
            </button>
            <button
              onClick={() => handleExportStub('share')}
              className="text-xs text-foreground-muted hover:text-foreground transition-colors px-3 py-1.5 border border-[var(--card-border)] hover:border-foreground-muted/30"
            >
              Share
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
