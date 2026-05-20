'use client';

import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConversationPair } from '@/lib/types';
import { ReportReader } from './ReportReader';

interface ConversationCardProps {
  pair: ConversationPair;
  index: number;
  onBookmark?: (pair: ConversationPair) => void;
  isBookmarked?: boolean;
}

function ConversationCardComponent({ pair, index, onBookmark, isBookmarked = false }: ConversationCardProps) {
  const { userMessage, assistantMessage, isStreaming } = pair;
  const [isHovered, setIsHovered] = useState(false);
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const renderCountRef = useRef(0);
  const previousContentLengthRef = useRef(assistantMessage?.content.length ?? 0);
  const previousCommitAtRef = useRef<number | null>(null);

  const hasReport = assistantMessage?.reportData;

  useEffect(() => {
    const streamTraceEnabled =
      process.env.NEXT_PUBLIC_SQUIRE_STREAM_TRACE === '1' ||
      (typeof window !== 'undefined' &&
        (window as unknown as Record<string, boolean>).__SQUIRE_STREAM_TRACE_ACTIVE__ === true);
    if (!streamTraceEnabled || !isStreaming || !assistantMessage) return;

    const committedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    renderCountRef.current += 1;
    const contentLength = assistantMessage.content.length;
    const deltaChars = contentLength - previousContentLengthRef.current;
    const sincePreviousCommitMs = previousCommitAtRef.current === null
      ? null
      : committedAt - previousCommitAtRef.current;
    previousContentLengthRef.current = contentLength;
    previousCommitAtRef.current = committedAt;

    if (
      renderCountRef.current <= 5 ||
      renderCountRef.current % 20 === 0 ||
      (sincePreviousCommitMs ?? 0) > 250
    ) {
      console.log('[ConversationCard][StreamTrace] streaming render committed', {
        pairId: pair.id,
        render: renderCountRef.current,
        contentLength,
        deltaChars,
        sincePreviousCommitMs: sincePreviousCommitMs === null
          ? null
          : Number(sincePreviousCommitMs.toFixed(2)),
      });
    }
  }, [assistantMessage, isStreaming, pair.id]);

  const handleOpenReader = useCallback(() => {
    setIsReaderOpen(true);
  }, []);

  const handleCloseReader = useCallback(() => {
    setIsReaderOpen(false);
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.3) }}
        className="relative border-l border-[var(--card-border)] bg-[var(--card-bg)] card-glow"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Bookmark button */}
        {(isHovered || isBookmarked) && !isStreaming && assistantMessage && (
          <button
            onClick={() => onBookmark?.(pair)}
            className={`absolute top-3 right-3 z-10 p-1.5 transition-all ${
              isBookmarked
                ? 'text-accent-mustard'
                : 'text-foreground-muted hover:text-accent-mustard'
            }`}
            title={isBookmarked ? 'Saved' : 'Save this card'}
          >
            <svg className="w-4 h-4" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
        )}

        {/* User message section */}
        {(userMessage.content || (userMessage.images && userMessage.images.length > 0)) && (
          <div className="px-5 pt-4 pb-2">
            {userMessage.images && userMessage.images.length > 0 && (
              <div className={`flex gap-2 flex-wrap${userMessage.content ? ' mb-2' : ''}`}>
                {userMessage.images.map((img, i) => {
                  // Prefer the persistent auth-proxy URL so reloads work.
                  // Fall back to the in-session base64 preview when objectId
                  // hasn't reached us yet (fresh upload before server ack).
                  const src = img.objectId
                    ? `/api/objects/${img.objectId}/download?variant=display&disposition=inline`
                    : img.preview;
                  if (!src) return null;
                  return (
                    <img
                      key={i}
                      src={src}
                      alt={img.name}
                      className="w-20 h-20 object-cover rounded border border-[var(--card-border)]"
                    />
                  );
                })}
              </div>
            )}
            {userMessage.content && (
              <p className="text-sm text-foreground-muted/60 leading-relaxed">
                {userMessage.content}
              </p>
            )}
          </div>
        )}

        {/* Divider */}
        {(userMessage.content || (userMessage.images && userMessage.images.length > 0)) && (assistantMessage || isStreaming) && (
          <div className="mx-5 border-t border-[var(--card-border)]" />
        )}

        {/* Assistant response section */}
        {hasReport ? (
          <div className="px-5 pt-3 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 bg-accent-mustard/15 text-accent-mustard border border-accent-mustard/30">
                Report
              </span>
            </div>
            <h3 className="font-[var(--font-instrument)] text-lg text-foreground font-normal mb-1">
              {assistantMessage!.reportData!.title}
            </h3>
            <p className="text-sm text-foreground-muted leading-relaxed mb-3">
              {assistantMessage!.reportData!.summary}
            </p>
            <button
              onClick={handleOpenReader}
              className="text-sm text-primary hover:text-primary-hover transition-colors font-medium"
            >
              Read Full Report →
            </button>
          </div>
        ) : assistantMessage ? (
          <div className="px-5 pt-3 pb-4">
            <div className="prose prose-invert prose-sm max-w-none text-foreground leading-relaxed
              [&_p]:mb-2 [&_p:last-child]:mb-0
              [&_code]:text-accent-mustard [&_code]:bg-background-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs
              [&_pre]:bg-background-tertiary [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-xs
              [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
              [&_strong]:text-foreground [&_strong]:font-semibold
              [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
              [&_li]:mb-1
              [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2
              [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2
              [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
              [&_blockquote]:border-l-2 [&_blockquote]:border-cream/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-foreground-muted
              [&_table]:w-full [&_table]:text-sm [&_table]:my-3
              [&_thead]:border-b [&_thead]:border-foreground-muted/20
              [&_th]:text-left [&_th]:text-foreground-muted [&_th]:font-medium [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:px-3 [&_th]:py-2
              [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-[var(--card-border)] [&_td]:text-foreground
              [&_tr:last-child_td]:border-b-0
            ">
              {isStreaming ? (
                <div className="whitespace-pre-wrap">{assistantMessage.content}</div>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistantMessage.content}</ReactMarkdown>
              )}
            </div>
          </div>
        ) : isStreaming ? (
          <div className="px-5 pt-3 pb-4">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : null}
      </motion.div>

      {/* Report reader overlay */}
      {hasReport && (
        <ReportReader
          report={assistantMessage!.reportData!}
          isOpen={isReaderOpen}
          onClose={handleCloseReader}
        />
      )}
    </>
  );
}

export const ConversationCard = memo(
  ConversationCardComponent,
  (prev, next) =>
    prev.index === next.index &&
    prev.pair.userMessage === next.pair.userMessage &&
    prev.pair.assistantMessage === next.pair.assistantMessage &&
    prev.pair.isStreaming === next.pair.isStreaming &&
    prev.isBookmarked === next.isBookmarked &&
    prev.onBookmark === next.onBookmark
);
