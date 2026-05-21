'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import type { MediaObject } from '@/lib/api/media';
import { deleteMedia, getConversationId, getDimensions, mediaUrl } from '@/lib/api/media';

interface MediaLightboxProps {
  item: MediaObject | null;
  onClose: () => void;
  /** Called after a successful delete; lets the parent prune local state. */
  onDeleted?: (id: string) => void;
  /** Hide the "Open conversation" link (already in chat → no use for it). */
  hideOpenConversation?: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const SOURCE_LABEL: Record<MediaObject['source'], string> = {
  upload: 'Chat upload',
  extract: 'PDF extract',
  generate: 'Generated',
  import: 'Imported',
};

export function MediaLightbox({
  item,
  onClose,
  onDeleted,
  hideOpenConversation = false,
}: MediaLightboxProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [deleteState, setDeleteState] = useState<'idle' | 'deleting' | 'error'>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setCopyState('idle');
    setDeleteState('idle');
    setDeleteError(null);
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [item, onClose]);

  const handleCopyLink = async () => {
    if (!item) return;
    try {
      const url = new URL(mediaUrl(item.id, 'display'), window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (err) {
      console.error('[MediaLightbox] copy failed', err);
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setDeleteState('deleting');
    setDeleteError(null);
    try {
      await deleteMedia(item.id);
      onDeleted?.(item.id);
      onClose();
    } catch (err) {
      console.error('[MediaLightbox] delete failed', err);
      setDeleteState('error');
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl max-h-[90vh] flex flex-col md:flex-row gap-4"
          >
            <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40 rounded-xl border border-[var(--glass-border)] overflow-hidden">
              <img
                src={mediaUrl(item.id, 'display')}
                alt={item.description ?? item.name}
                className="max-h-[80vh] max-w-full object-contain"
              />
            </div>

            <aside className="w-full md:w-72 shrink-0 bg-background-secondary/95 backdrop-blur-md rounded-xl border border-[var(--glass-border)] p-4 overflow-y-auto">
              <header className="flex items-start justify-between gap-2 mb-3">
                <h2 className="text-sm font-medium text-foreground truncate">{item.name}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="shrink-0 text-foreground-muted hover:text-foreground p-1 -m-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </header>

              <dl className="space-y-2 text-xs text-foreground-muted">
                <Row label="Source" value={SOURCE_LABEL[item.source]} />
                <Row label="Created" value={formatDate(item.created_at)} />
                <Row label="Size" value={formatBytes(item.size_bytes)} />
                {(() => {
                  const dims = getDimensions(item);
                  return dims ? <Row label="Dimensions" value={`${dims.width} × ${dims.height}`} /> : null;
                })()}
                <Row label="MIME" value={item.mime_type} />
                <Row label="Storage" value={item.storage_type} />
                {item.description && (
                  <div>
                    <dt className="text-foreground-muted/80">Description</dt>
                    <dd className="text-foreground/90 mt-1 leading-snug">{item.description}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-4 space-y-2">
                {(() => {
                  if (hideOpenConversation) return null;
                  const conversationId = getConversationId(item);
                  if (!conversationId) return null;
                  return (
                    <Link
                      href={`/app/chat?conversationId=${encodeURIComponent(conversationId)}`}
                      className="block w-full text-center px-3 py-2 rounded-lg bg-primary text-background text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      Open conversation
                    </Link>
                  );
                })()}
                <a
                  href={mediaUrl(item.id, 'original', 'attachment')}
                  className="block w-full text-center px-3 py-2 rounded-lg bg-background-tertiary text-foreground text-xs font-medium hover:bg-background-tertiary/80 transition-colors border border-[var(--glass-border)]"
                >
                  Download original
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="block w-full text-center px-3 py-2 rounded-lg bg-background-tertiary text-foreground text-xs font-medium hover:bg-background-tertiary/80 transition-colors border border-[var(--glass-border)]"
                >
                  {copyState === 'copied'
                    ? 'Link copied'
                    : copyState === 'error'
                      ? 'Copy failed — try again'
                      : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteState === 'deleting'}
                  className="block w-full text-center px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-xs font-medium hover:bg-red-500/25 transition-colors border border-red-500/30 disabled:opacity-60 disabled:cursor-wait"
                >
                  {deleteState === 'deleting' ? 'Deleting…' : 'Delete'}
                </button>
                {deleteError && (
                  <p className="text-[11px] text-red-300/90 leading-snug">{deleteError}</p>
                )}
              </div>
            </aside>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-foreground-muted/80">{label}</dt>
      <dd className="text-foreground/90 text-right truncate">{value}</dd>
    </div>
  );
}
