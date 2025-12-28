'use client';

import { useState, useEffect } from 'react';
import { Commitment, CommitmentStatus } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const statusColors: Record<CommitmentStatus, string> = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  canceled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  snoozed: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const statusIcons: Record<CommitmentStatus, string> = {
  open: '○',
  in_progress: '◐',
  completed: '●',
  canceled: '✕',
  snoozed: '◑',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No due date';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due in ${days} days`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CommitmentCard({
  commitment,
  onResolve,
  onSnooze
}: {
  commitment: Commitment;
  onResolve: (id: string, type: string) => void;
  onSnooze: (id: string) => void;
}) {
  const isOverdue = commitment.due_at && new Date(commitment.due_at) < new Date() &&
    commitment.status !== 'completed' && commitment.status !== 'canceled';

  return (
    <div className={`p-4 rounded-lg border ${isOverdue ? 'border-red-500/50 bg-red-500/5' : 'border-white/10 bg-white/5'} hover:bg-white/10 transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-xs rounded border ${statusColors[commitment.status]}`}>
              {statusIcons[commitment.status]} {commitment.status.replace('_', ' ')}
            </span>
            {commitment.source_type === 'chat' && (
              <span className="text-xs text-gray-500">from chat</span>
            )}
          </div>
          <h3 className="font-medium text-white truncate">{commitment.title}</h3>
          {commitment.description && (
            <p className="text-sm text-gray-400 mt-1 line-clamp-2">{commitment.description}</p>
          )}
          <p className={`text-xs mt-2 ${isOverdue ? 'text-red-400' : 'text-gray-500'}`}>
            {formatDate(commitment.due_at)}
          </p>
        </div>
        {commitment.status !== 'completed' && commitment.status !== 'canceled' && (
          <div className="flex gap-1">
            <button
              onClick={() => onResolve(commitment.id, 'completed')}
              className="p-2 rounded hover:bg-green-500/20 text-green-400 transition-colors"
              title="Mark complete"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={() => onSnooze(commitment.id)}
              className="p-2 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
              title="Snooze 1 day"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [stats, setStats] = useState<Record<CommitmentStatus, number>>({ open: 0, in_progress: 0, completed: 0, canceled: 0, snoozed: 0 });

  const fetchCommitments = async () => {
    try {
      const includeResolved = filter === 'completed' || filter === 'all';
      const status = filter === 'completed' ? 'completed' : undefined;
      const params = new URLSearchParams();
      if (includeResolved) params.set('include_resolved', 'true');
      if (status) params.set('status', status);

      const res = await fetch(`${API_URL}/api/commitments?${params}`);
      const data = await res.json();
      setCommitments(data.commitments || []);
    } catch (err) {
      console.error('Failed to fetch commitments:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/commitments/stats`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  useEffect(() => {
    fetchCommitments();
    fetchStats();
  }, [filter]);

  const handleResolve = async (id: string, resolutionType: string) => {
    try {
      await fetch(`${API_URL}/api/commitments/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_type: resolutionType }),
      });
      fetchCommitments();
      fetchStats();
    } catch (err) {
      console.error('Failed to resolve:', err);
    }
  };

  const handleSnooze = async (id: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    try {
      await fetch(`${API_URL}/api/commitments/${id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snooze_until: tomorrow.toISOString() }),
      });
      fetchCommitments();
      fetchStats();
    } catch (err) {
      console.error('Failed to snooze:', err);
    }
  };

  const activeCount = stats.open + stats.in_progress + stats.snoozed;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Commitments</h1>
          <p className="text-gray-400">Track your goals, tasks, and promises</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="text-2xl font-bold text-blue-400">{stats.open}</div>
            <div className="text-xs text-gray-400">Open</div>
          </div>
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="text-2xl font-bold text-yellow-400">{stats.in_progress}</div>
            <div className="text-xs text-gray-400">In Progress</div>
          </div>
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
            <div className="text-xs text-gray-400">Completed</div>
          </div>
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <div className="text-2xl font-bold text-purple-400">{stats.snoozed}</div>
            <div className="text-xs text-gray-400">Snoozed</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {(['active', 'completed', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {f === 'active' ? `Active (${activeCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : commitments.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No commitments found</div>
            <p className="text-sm text-gray-600">
              Commitments are created automatically when you mention goals or tasks in chat
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {commitments.map((c) => (
              <CommitmentCard
                key={c.id}
                commitment={c}
                onResolve={handleResolve}
                onSnooze={handleSnooze}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
