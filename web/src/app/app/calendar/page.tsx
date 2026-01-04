'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CalendarEvent } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type ViewMode = 'week' | 'month';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatTime(dateStr: string, allDay: boolean): string {
  if (allDay) return 'All day';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

interface EventCardProps {
  event: CalendarEvent;
  compact?: boolean;
  onClick: (event: CalendarEvent) => void;
}

function EventCard({ event, compact = false, onClick }: EventCardProps) {
  const isGoogle = event.source === 'google';
  const color = event.color || (isGoogle ? '#4285f4' : '#3b82f6');

  // Recurrence icon
  const RecurrenceIcon = () => (
    <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Recurring event">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );

  if (compact) {
    return (
      <button
        onClick={() => onClick(event)}
        className="w-full text-left px-1.5 py-0.5 text-xs rounded truncate hover:opacity-80 transition-opacity flex items-center gap-1"
        style={{ backgroundColor: color + '30', color: color, borderLeft: `2px solid ${color}` }}
      >
        {event.isRecurring && <RecurrenceIcon />}
        <span className="truncate">{event.title}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => onClick(event)}
      className="w-full text-left p-2 rounded-lg hover:opacity-80 transition-opacity group"
      style={{ backgroundColor: color + '20', borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white text-sm truncate flex items-center gap-1.5">
            {event.isRecurring && <RecurrenceIcon />}
            {event.title}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {formatTime(event.start, event.allDay)}
            {event.location && <span className="ml-2">@ {event.location}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isGoogle && event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-white/10"
              title="Open in Google Calendar"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          isGoogle ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'
        }`}>
          {isGoogle ? (event.googleCalendarName || 'Google') : 'Squire'}
        </span>
        {event.isRecurring && (
          <span className="text-xs text-gray-500">Recurring</span>
        )}
        {event.status && event.status !== 'open' && event.status !== 'confirmed' && (
          <span className="text-xs text-gray-500">{event.status}</span>
        )}
      </div>
    </button>
  );
}

interface EventDetailsPanelProps {
  event: CalendarEvent | null;
  onClose: () => void;
}

function EventDetailsPanel({ event, onClose }: EventDetailsPanelProps) {
  if (!event) return null;

  const isGoogle = event.source === 'google';
  const color = event.color || (isGoogle ? '#4285f4' : '#3b82f6');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/10" style={{ borderLeftColor: color, borderLeftWidth: '4px' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-white">{event.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  isGoogle ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'
                }`}>
                  {isGoogle ? (event.googleCalendarName || 'Google Calendar') : 'Squire Commitment'}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div className="text-white">
                {new Date(event.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="text-gray-400 text-sm">
                {event.allDay ? 'All day' : (
                  <>
                    {formatTime(event.start, false)}
                    {event.end && ` - ${formatTime(event.end, false)}`}
                  </>
                )}
              </div>
            </div>
          </div>

          {event.location && (
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div className="text-white">{event.location}</div>
            </div>
          )}

          {event.description && (
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <div className="text-gray-300 text-sm whitespace-pre-wrap">{event.description}</div>
            </div>
          )}

          {event.isRecurring && (
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-gray-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div>
                <div className="text-white">Recurring event</div>
                {event.isOccurrence && event.occurrenceIndex !== undefined && (
                  <div className="text-gray-400 text-sm">
                    Occurrence #{event.occurrenceIndex + 1}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex gap-2">
          {isGoogle && event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-center text-sm font-medium transition-colors"
            >
              Open in Google Calendar
            </a>
          )}
          {!isGoogle && event.commitmentId && (
            <a
              href={`/app/commitments?id=${event.commitmentId}`}
              className="flex-1 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-center text-sm font-medium transition-colors"
            >
              View Commitment
            </a>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', description: '', startDate: '', startTime: '', endTime: '', allDay: false });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const fetchEvents = async () => {
      setLoading(true);
      try {
        let url: string;
        if (viewMode === 'week') {
          url = `${API_URL}/api/calendar/week?date=${currentDate.toISOString().split('T')[0]}`;
        } else {
          url = `${API_URL}/api/calendar/month?year=${currentDate.getFullYear()}&month=${currentDate.getMonth() + 1}`;
        }

        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        // Flatten the days object into an array of events
        const allEvents: CalendarEvent[] = [];
        if (data.days) {
          Object.values(data.days as Record<string, CalendarEvent[]>).forEach((dayEvents) => {
            allEvents.push(...dayEvents);
          });
        }

        setEvents(allEvents);
      } catch (err) {
        // Ignore abort errors - they're expected when navigating quickly
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch events:', err);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();

    return () => controller.abort();
  }, [viewMode, currentDate]);

  // Keep fetchEvents for manual refresh (e.g., after creating event)
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      let url: string;
      if (viewMode === 'week') {
        url = `${API_URL}/api/calendar/week?date=${currentDate.toISOString().split('T')[0]}`;
      } else {
        url = `${API_URL}/api/calendar/month?year=${currentDate.getFullYear()}&month=${currentDate.getMonth() + 1}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      const allEvents: CalendarEvent[] = [];
      if (data.days) {
        Object.values(data.days as Record<string, CalendarEvent[]>).forEach((dayEvents) => {
          allEvents.push(...dayEvents);
        });
      }

      setEvents(allEvents);
    } catch (err) {
      console.error('Failed to fetch events:', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [viewMode, currentDate]);

  const navigatePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.title.trim() || !newEvent.startDate) return;

    setCreating(true);
    try {
      let dueAt: Date;
      let durationMinutes: number | undefined;

      if (newEvent.allDay) {
        dueAt = new Date(newEvent.startDate + 'T00:00:00');
      } else {
        if (!newEvent.startTime) {
          alert('Start time is required for non-all-day events');
          setCreating(false);
          return;
        }
        dueAt = new Date(newEvent.startDate + 'T' + newEvent.startTime);
        if (newEvent.endTime) {
          const endDate = new Date(newEvent.startDate + 'T' + newEvent.endTime);
          durationMinutes = Math.round((endDate.getTime() - dueAt.getTime()) / 60000);
          if (durationMinutes <= 0) durationMinutes = 60;
        }
      }

      const res = await fetch(`${API_URL}/api/commitments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newEvent.title,
          description: newEvent.description || undefined,
          due_at: dueAt.toISOString(),
          all_day: newEvent.allDay,
          duration_minutes: durationMinutes,
          timezone: 'America/New_York',
          source_type: 'manual',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create event');
      }
      setNewEvent({ title: '', description: '', startDate: '', startTime: '', endTime: '', allDay: false });
      setShowAddModal(false);
      fetchEvents();
    } catch (err) {
      console.error('Failed to create event:', err);
      alert(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setCreating(false);
    }
  };

  // Calculate week start (Sunday) for week view
  const weekStart = new Date(currentDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  // Calculate month start for month view
  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = monthStart.getDay();

  const getEventsForDay = (date: Date): CalendarEvent[] => {
    return events.filter(e => isSameDay(new Date(e.start), date))
      .sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      });
  };

  const renderWeekView = () => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      const dayEvents = getEventsForDay(day);
      const today = isToday(day);

      days.push(
        <div key={i} className={`flex-1 min-w-0 ${i < 6 ? 'border-r border-white/5' : ''}`}>
          <div className={`sticky top-0 p-2 text-center border-b border-white/10 ${
            today ? 'bg-blue-500/10' : 'bg-gray-900/50'
          }`}>
            <div className={`text-xs font-medium ${today ? 'text-blue-400' : 'text-gray-400'}`}>
              {WEEKDAYS[i]}
            </div>
            <div className={`text-lg font-semibold ${today ? 'text-blue-400' : 'text-white'}`}>
              {day.getDate()}
            </div>
          </div>
          <div className="p-1 space-y-1 min-h-[400px]">
            {dayEvents.length === 0 && (
              <div className="text-xs text-gray-600 text-center py-4">No events</div>
            )}
            {dayEvents.map(event => (
              <EventCard key={event.id} event={event} onClick={setSelectedEvent} />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="flex border border-white/10 rounded-lg overflow-hidden bg-gray-900/30">
        {days}
      </div>
    );
  };

  const renderMonthView = () => {
    const cells = [];

    // Empty cells for days before month start
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(
        <div key={`empty-${i}`} className="border border-white/5 bg-gray-900/20 min-h-[100px]" />
      );
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
      const dayEvents = getEventsForDay(date);
      const today = isToday(date);

      cells.push(
        <div
          key={day}
          className={`border border-white/5 min-h-[100px] p-1 ${
            today ? 'bg-blue-500/5' : 'bg-gray-900/30'
          }`}
        >
          <div className={`text-sm font-medium mb-1 ${today ? 'text-blue-400' : 'text-gray-400'}`}>
            {day}
          </div>
          <div className="space-y-0.5">
            {dayEvents.slice(0, 3).map(event => (
              <EventCard key={event.id} event={event} compact onClick={setSelectedEvent} />
            ))}
            {dayEvents.length > 3 && (
              <button
                onClick={() => {
                  // Could expand to show all events
                }}
                className="text-xs text-gray-500 hover:text-gray-400 pl-1"
              >
                +{dayEvents.length - 3} more
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-7 rounded-lg overflow-hidden border border-white/10">
        {/* Header */}
        {WEEKDAYS.map(day => (
          <div key={day} className="text-center text-xs font-medium text-gray-400 py-2 bg-gray-900/50 border-b border-white/10">
            {day}
          </div>
        ))}
        {cells}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Calendar</h1>
            <p className="text-gray-400 text-sm">
              {viewMode === 'week'
                ? `${formatDateShort(weekStart)} - ${formatDateShort(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000))}`
                : `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
              }
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Legend */}
            <div className="hidden sm:flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-purple-500" />
                <span className="text-gray-400">Squire</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-gray-400">Google</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-gray-400">Recurring</span>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'week'
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'month'
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Month
              </button>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-1">
              <button
                onClick={goToToday}
                className="px-3 py-1.5 text-sm rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
              >
                Today
              </button>
              <button
                onClick={navigatePrev}
                className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={navigateNext}
                className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Add Event Button */}
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Event
            </button>

            {/* Settings Link */}
            <a
              href="/app/settings/integrations"
              className="p-1.5 rounded-lg border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
              title="Manage Integrations"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          </div>
        </div>

        {/* Calendar View */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : viewMode === 'week' ? (
          renderWeekView()
        ) : (
          renderMonthView()
        )}

        {/* Empty State */}
        {!loading && events.length === 0 && (
          <div className="text-center py-12 mt-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No events this {viewMode}</h3>
            <p className="text-gray-400 text-sm mb-6">
              Create commitments in chat or connect Google Calendar to see events here
            </p>
            <div className="flex gap-3 justify-center">
              <a
                href="/app/chat"
                className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg text-sm font-medium transition-colors"
              >
                Go to Chat
              </a>
              <a
                href="/app/settings/integrations"
                className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm font-medium transition-colors"
              >
                Connect Google Calendar
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Event Details Panel */}
      <EventDetailsPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-white/10 w-full max-w-md">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Add Event</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateEvent} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Title *</label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  placeholder="Event title"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Date *</label>
                <input
                  type="date"
                  value={newEvent.startDate}
                  onChange={(e) => setNewEvent({ ...newEvent, startDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="allDay"
                  checked={newEvent.allDay}
                  onChange={(e) => setNewEvent({ ...newEvent, allDay: e.target.checked })}
                  className="w-4 h-4 rounded border-white/20 bg-white/5"
                />
                <label htmlFor="allDay" className="text-sm text-gray-300">All day event</label>
              </div>
              {!newEvent.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Start Time *</label>
                    <input
                      type="time"
                      value={newEvent.startTime}
                      onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      required={!newEvent.allDay}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">End Time</label>
                    <input
                      type="time"
                      value={newEvent.endTime}
                      onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Description (optional)</label>
                <textarea
                  value={newEvent.description}
                  onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                  placeholder="Event details..."
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
                  disabled={creating || !newEvent.title.trim() || !newEvent.startDate}
                  className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {creating && (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {creating ? 'Creating...' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
