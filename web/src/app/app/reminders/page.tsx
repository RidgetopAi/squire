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
  const isPast = new Date(reminder.scheduled_for) < new Date();
  const canAct = reminder.status === 'pending' || reminder.status === 'sent';

  return (
    <div className={`p-4 rounded-lg border ${isPast && canAct ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-white/10 bg-white/5'} hover:bg-white/10 transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-xs rounded border ${statusColors[reminder.status]}`}>
              {statusIcons[reminder.status]} {reminder.status}
            </span>
            <span className="text-xs text-gray-500">{reminder.channel}</span>
          </div>
          <h3 className="font-medium text-white truncate">{reminder.title || 'Commitment Reminder'}</h3>
          {reminder.body && (
            <p className="text-sm text-gray-400 mt-1 line-clamp-2">{reminder.body}</p>
          )}
          <p className={`text-xs mt-2 ${isPast && canAct ? 'text-yellow-400' : 'text-gray-500'}`}>
            {formatScheduledTime(reminder.scheduled_for)}
          </p>
        </div>
        {canAct && (
          <div className="flex gap-1">
            <button
              onClick={() => onAcknowledge(reminder.id)}
              className="p-2 rounded hover:bg-green-500/20 text-green-400 transition-colors"
              title="Acknowledge"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              onClick={() => onSnooze(reminder.id, 15)}
              className="p-2 rounded hover:bg-purple-500/20 text-purple-400 transition-colors"
              title="Snooze 15 min"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              onClick={() => onCancel(reminder.id)}
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
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [stats, setStats] = useState<Record<ReminderStatus, number>>({
    pending: 0, sent: 0, acknowledged: 0, snoozed: 0, canceled: 0, failed: 0
  });

  const fetchReminders = async () => {
    try {
      const params = new URLSearchParams();
      if (filter === 'upcoming') {
        params.set('status', 'pending');
      } else if (filter === 'past') {
        params.set('status', 'acknowledged');
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
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  useEffect(() => {
    fetchReminders();
    fetchStats();
  }, [filter]);

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

  const upcomingCount = stats.pending + stats.snoozed;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">Reminders</h1>
          <p className="text-gray-400">Your scheduled reminders and notifications</p>
        </div>

        {/* Push Notification Permission */}
        <PushPermission className="mb-6" />

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="text-2xl font-bold text-blue-400">{stats.pending}</div>
            <div className="text-xs text-gray-400">Pending</div>
          </div>
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <div className="text-2xl font-bold text-purple-400">{stats.snoozed}</div>
            <div className="text-xs text-gray-400">Snoozed</div>
          </div>
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="text-2xl font-bold text-green-400">{stats.acknowledged}</div>
            <div className="text-xs text-gray-400">Done</div>
          </div>
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="text-2xl font-bold text-yellow-400">{stats.sent}</div>
            <div className="text-xs text-gray-400">Sent</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {(['upcoming', 'past', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {f === 'upcoming' ? `Upcoming (${upcomingCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

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
      </div>
    </div>
  );
}
