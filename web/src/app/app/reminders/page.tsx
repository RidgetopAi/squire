'use client';

import { useState, useEffect } from 'react';
import { PushPermission } from '@/components/notifications';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type ReminderStatus = 'pending' | 'sent' | 'acknowledged' | 'snoozed' | 'canceled' | 'failed';

interface Reminder {
  id: string;
  commitment_id: string | null;
  title: string | null;
  body: string | null;
  scheduled_for: string;
  timezone: string;
  channel: string;
  status: ReminderStatus;
  sent_at: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  created_at: string;
}

const statusColors: Record<ReminderStatus, string> = {
  pending: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  sent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  acknowledged: 'bg-green-500/20 text-green-400 border-green-500/30',
  snoozed: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  canceled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusIcons: Record<ReminderStatus, string> = {
  pending: '⏰',
  sent: '📤',
  acknowledged: '✓',
  snoozed: '💤',
  canceled: '✕',
  failed: '⚠',
};

function formatScheduledTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const minutes = Math.round(diff / (1000 * 60));

  if (minutes < 0) {
    const pastMinutes = Math.abs(minutes);
    if (pastMinutes < 60) return `${pastMinutes} min ago`;
    if (pastMinutes < 1440) return `${Math.round(pastMinutes / 60)} hr ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  if (minutes < 1) return 'Now';
  if (minutes < 60) return `In ${minutes} min`;
  if (minutes < 1440) return `In ${Math.round(minutes / 60)} hr`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatFullDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function ReminderCard({
  reminder,
  onSnooze,
  onAcknowledge,
  onCancel,
}: {
  reminder: Reminder;
  onSnooze: (id: string, minutes: number) => void;
  onAcknowledge: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPast = new Date(reminder.scheduled_for) < new Date();
  const canAct = reminder.status === 'pending' || reminder.status === 'sent';

  // Check if body is long enough to warrant expansion
  const hasLongBody = reminder.body && reminder.body.length > 100;
  const isExpandable = hasLongBody || reminder.commitment_id;

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking on action buttons
    if ((e.target as HTMLElement).closest('button')) return;
    if (isExpandable) {
      setExpanded(!expanded);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className={`p-4 rounded-lg border transition-all duration-200 ${
        isPast && canAct ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-white/10 bg-white/5'
      } ${isExpandable ? 'cursor-pointer hover:bg-white/10' : ''} ${expanded ? 'bg-white/10' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-xs rounded border ${statusColors[reminder.status]}`}>
              {statusIcons[reminder.status]} {reminder.status}
            </span>
            <span className="text-xs text-gray-500">{reminder.channel}</span>
            {isExpandable && (
              <span className="text-xs text-gray-600">
                {expanded ? '▼' : '▶'}
              </span>
            )}
          </div>
          <h3 className={`font-medium text-white ${expanded ? '' : 'truncate'}`}>
            {reminder.title || 'Commitment Reminder'}
          </h3>
          {reminder.body && (
            <p className={`text-sm text-gray-400 mt-1 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
              {reminder.body}
            </p>
          )}
          <p className={`text-xs mt-2 ${isPast && canAct ? 'text-yellow-400' : 'text-gray-500'}`}>
            {expanded ? formatFullDateTime(reminder.scheduled_for) : formatScheduledTime(reminder.scheduled_for)}
          </p>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Timezone:</span>{' '}
                  <span className="text-gray-300">{reminder.timezone}</span>
                </div>
                <div>
                  <span className="text-gray-500">Created:</span>{' '}
                  <span className="text-gray-300">
                    {new Date(reminder.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {reminder.sent_at && (
                  <div>
                    <span className="text-gray-500">Sent:</span>{' '}
                    <span className="text-gray-300">
                      {new Date(reminder.sent_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
                {reminder.acknowledged_at && (
                  <div>
                    <span className="text-gray-500">Acknowledged:</span>{' '}
                    <span className="text-gray-300">
                      {new Date(reminder.acknowledged_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
                {reminder.snoozed_until && (
                  <div>
                    <span className="text-gray-500">Snoozed until:</span>{' '}
                    <span className="text-purple-400">
                      {new Date(reminder.snoozed_until).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
                {reminder.commitment_id && (
                  <div className="col-span-2">
                    <span className="text-gray-500">Linked to commitment:</span>{' '}
                    <span className="text-blue-400 text-xs font-mono">{reminder.commitment_id.slice(0, 8)}...</span>
                  </div>
                )}
              </div>

              {/* Extended snooze options when expanded */}
              {canAct && (
                <div className="pt-2">
                  <span className="text-xs text-gray-500 block mb-2">Snooze for:</span>
                  <div className="flex flex-wrap gap-2">
                    {[5, 15, 30, 60, 120, 1440].map((mins) => (
                      <button
                        key={mins}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSnooze(reminder.id, mins);
                        }}
                        className="px-2 py-1 text-xs rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/30 transition-colors"
                      >
                        {mins < 60 ? `${mins}m` : mins < 1440 ? `${mins / 60}h` : '1d'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {canAct && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge(reminder.id);
              }}
              className="p-2 rounded hover:bg-green-500/20 text-green-400 transition-colors"
              title="Acknowledge"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSnooze(reminder.id, 15);
              }}
              className="p-2 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
              title="Snooze 15 min"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel(reminder.id);
              }}
              className="p-2 rounded hover:bg-red-500/20 text-red-400 transition-colors"
              title="Cancel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ReminderStatus | null>('pending');
  const [stats, setStats] = useState<Record<ReminderStatus, number>>({
    pending: 0, sent: 0, acknowledged: 0, snoozed: 0, canceled: 0, failed: 0
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newReminder, setNewReminder] = useState({ title: '', body: '', scheduledFor: '' });
  const [creating, setCreating] = useState(false);

  const fetchReminders = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) {
        params.set('status', statusFilter);
      }

      const res = await fetch(`${API_URL}/api/reminders?${params}`);
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch (err) {
      console.error('Failed to fetch reminders:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/reminders/stats`);
      const data = await res.json();
      setStats(data.by_status || data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  useEffect(() => {
    fetchReminders();
    fetchStats();
  }, [statusFilter]);

  const handleSnooze = async (id: string, minutes: number) => {
    try {
      await fetch(`${API_URL}/api/reminders/${id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snooze_minutes: minutes }),
      });
      fetchReminders();
      fetchStats();
    } catch (err) {
      console.error('Failed to snooze:', err);
    }
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/reminders/${id}/acknowledge`, {
        method: 'POST',
      });
      fetchReminders();
      fetchStats();
    } catch (err) {
      console.error('Failed to acknowledge:', err);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/reminders/${id}/cancel`, {
        method: 'POST',
      });
      fetchReminders();
      fetchStats();
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
  };

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminder.title.trim() || !newReminder.scheduledFor) return;

    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/reminders/standalone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newReminder.title,
          body: newReminder.body || undefined,
          scheduled_at: new Date(newReminder.scheduledFor).toISOString(),
          timezone: 'America/New_York',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create reminder');
      }
      setNewReminder({ title: '', body: '', scheduledFor: '' });
      setShowAddModal(false);
      fetchReminders();
      fetchStats();
    } catch (err) {
      console.error('Failed to create reminder:', err);
      alert(err instanceof Error ? err.message : 'Failed to create reminder');
    } finally {
      setCreating(false);
    }
  };

  const handleStatusClick = (status: ReminderStatus) => {
    setStatusFilter(statusFilter === status ? null : status);
  };

  const totalCount = stats.pending + stats.snoozed + stats.acknowledged + stats.sent;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Reminders</h1>
            <p className="text-gray-400">Your scheduled reminders and notifications</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Reminder
          </button>
        </div>

        {/* Push Notification Permission */}
        <PushPermission className="mb-6" />

        {/* Stats - Clickable Filters */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <button
            onClick={() => handleStatusClick('pending')}
            className={`p-3 rounded-lg border transition-all text-left ${
              statusFilter === 'pending'
                ? 'bg-blue-500/30 border-blue-400 ring-2 ring-blue-400/50'
                : 'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20'
            }`}
          >
            <div className="text-2xl font-bold text-blue-400">{stats.pending}</div>
            <div className="text-xs text-gray-400">Pending</div>
          </button>
          <button
            onClick={() => handleStatusClick('snoozed')}
            className={`p-3 rounded-lg border transition-all text-left ${
              statusFilter === 'snoozed'
                ? 'bg-purple-500/30 border-purple-400 ring-2 ring-purple-400/50'
                : 'bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20'
            }`}
          >
            <div className="text-2xl font-bold text-purple-400">{stats.snoozed}</div>
            <div className="text-xs text-gray-400">Snoozed</div>
          </button>
          <button
            onClick={() => handleStatusClick('acknowledged')}
            className={`p-3 rounded-lg border transition-all text-left ${
              statusFilter === 'acknowledged'
                ? 'bg-green-500/30 border-green-400 ring-2 ring-green-400/50'
                : 'bg-green-500/10 border-green-500/20 hover:bg-green-500/20'
            }`}
          >
            <div className="text-2xl font-bold text-green-400">{stats.acknowledged}</div>
            <div className="text-xs text-gray-400">Done</div>
          </button>
          <button
            onClick={() => handleStatusClick('sent')}
            className={`p-3 rounded-lg border transition-all text-left ${
              statusFilter === 'sent'
                ? 'bg-yellow-500/30 border-yellow-400 ring-2 ring-yellow-400/50'
                : 'bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20'
            }`}
          >
            <div className="text-2xl font-bold text-yellow-400">{stats.sent}</div>
            <div className="text-xs text-gray-400">Sent</div>
          </button>
        </div>

        {/* Show All button when filtered */}
        {statusFilter && (
          <div className="mb-4">
            <button
              onClick={() => setStatusFilter(null)}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Show all ({totalCount})
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : reminders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500 mb-2">No reminders found</div>
            <p className="text-sm text-gray-600">
              Say &quot;remind me in X minutes to...&quot; in chat to create reminders
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                onSnooze={handleSnooze}
                onAcknowledge={handleAcknowledge}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}

        {/* Add Reminder Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-xl border border-white/10 w-full max-w-md">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Add Reminder</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleCreateReminder} className="p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Title *</label>
                  <input
                    type="text"
                    value={newReminder.title}
                    onChange={(e) => setNewReminder({ ...newReminder, title: e.target.value })}
                    placeholder="What do you need to remember?"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">When *</label>
                  <input
                    type="datetime-local"
                    value={newReminder.scheduledFor}
                    onChange={(e) => setNewReminder({ ...newReminder, scheduledFor: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Notes (optional)</label>
                  <textarea
                    value={newReminder.body}
                    onChange={(e) => setNewReminder({ ...newReminder, body: e.target.value })}
                    placeholder="Additional details..."
                    rows={3}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !newReminder.title.trim() || !newReminder.scheduledFor}
                    className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {creating && (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    {creating ? 'Creating...' : 'Create Reminder'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
