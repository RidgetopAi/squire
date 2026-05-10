'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Note, CreateNoteInput, UpdateNoteInput } from '@/lib/types';
import {
  fetchNotes,
  createNote,
  updateNote,
  archiveNote,
  deleteNote,
  pinNote,
  unpinNote,
} from '@/lib/api/notes';
import { NotesList } from '@/components/notes/NotesList';
import { NoteEditor } from '@/components/notes/NoteEditor';

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchNotes({ limit: 100 });
      setNotes(data);
    } catch (err) {
      console.error('Failed to load notes:', err);
      setError('Failed to load notes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleEdit = (note: Note) => {
    setEditingNote(note);
    setEditorOpen(true);
  };

  const handleCreateNew = () => {
    setEditingNote(null);
    setEditorOpen(true);
  };

  const upsertNote = useCallback((nextNote: Note) => {
    setNotes((prev) => {
      const existingIndex = prev.findIndex((note) => note.id === nextNote.id);
      if (existingIndex === -1) {
        return [nextNote, ...prev];
      }

      const updated = [...prev];
      updated[existingIndex] = nextNote;
      return updated;
    });
  }, []);

  const handleSave = async (input: CreateNoteInput | UpdateNoteInput, noteId?: string): Promise<Note> => {
    const saved = noteId
      ? await updateNote(noteId, input as UpdateNoteInput)
      : await createNote(input as CreateNoteInput);

    upsertNote(saved);
    return saved;
  };

  const handlePin = async (note: Note) => {
    try {
      const updated = note.is_pinned
        ? await unpinNote(note.id)
        : await pinNote(note.id);
      upsertNote(updated);
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleArchive = async (note: Note) => {
    if (!confirm('Archive this note?')) return;
    try {
      await archiveNote(note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (err) {
      console.error('Failed to archive note:', err);
    }
  };

  const handleDelete = async (note: Note) => {
    if (!confirm('Permanently delete this note? This cannot be undone.')) return;
    try {
      await deleteNote(note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notes</h1>
          <p className="text-sm text-foreground-muted mt-1">
            Capture and organize your thoughts
          </p>
        </div>
        <button
          onClick={handleCreateNew}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Note
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
          {error}
          <button
            onClick={loadNotes}
            className="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      <NotesList
        notes={notes}
        isLoading={isLoading}
        onEdit={handleEdit}
        onPin={handlePin}
        onArchive={handleArchive}
        onDelete={handleDelete}
      />

      <NoteEditor
        note={editingNote}
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingNote(null);
        }}
        onSave={handleSave}
        onNoteUpdated={upsertNote}
      />
    </div>
  );
}
