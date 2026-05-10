import { Router, type Request, type Response } from 'express';
import {
  createNote,
  getNote,
  updateNote,
  archiveNote,
  deleteNote,
  listNotes,
  searchNotes,
  getNotesByEntity,
  getPinnedNotes,
  linkNoteToEntity,
  unlinkNoteFromEntity,
  pinNote,
  unpinNote,
  exportNotes,
  attachObjectToNote,
  detachObjectFromNote,
  type NoteSourceType,
} from '../../services/storage/notes.js';
import { getObjectById } from '../../services/storage/objects.js';

interface IdParams {
  id: string;
}

interface EntityParams {
  entityId: string;
}

interface AttachmentParams extends IdParams {
  objectId: string;
}

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const category = req.query.category as string | undefined;
    const entity_id = req.query.entity_id as string | undefined;
    const is_pinned = req.query.is_pinned === 'true' ? true : req.query.is_pinned === 'false' ? false : undefined;
    const include_archived = req.query.include_archived === 'true';
    const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;

    const notes = await listNotes({
      limit,
      offset,
      category,
      entity_id,
      is_pinned,
      include_archived,
      tags,
    });

    res.json({
      notes,
      count: notes.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error listing notes:', error);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 20;
    const threshold = parseFloat(req.query.threshold as string) || 0.3;
    const entity_id = req.query.entity_id as string | undefined;
    const category = req.query.category as string | undefined;

    const notes = await searchNotes(query, { limit, threshold, entity_id, category });

    res.json({
      notes,
      count: notes.length,
      query,
    });
  } catch (error) {
    console.error('Error searching notes:', error);
    res.status(500).json({ error: 'Failed to search notes' });
  }
});

router.get('/pinned', async (_req: Request, res: Response): Promise<void> => {
  try {
    const notes = await getPinnedNotes();
    res.json({ notes, count: notes.length });
  } catch (error) {
    console.error('Error getting pinned notes:', error);
    res.status(500).json({ error: 'Failed to get pinned notes' });
  }
});

router.get('/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const format = (req.query.format as 'json' | 'markdown' | 'csv') || 'json';
    const entity_id = req.query.entity_id as string | undefined;
    const category = req.query.category as string | undefined;
    const include_archived = req.query.include_archived === 'true';
    const include_metadata = req.query.include_metadata === 'true';

    const result = await exportNotes({
      format,
      entity_id,
      category,
      include_archived,
      include_metadata,
    });

    const contentTypes: Record<string, string> = {
      json: 'application/json',
      markdown: 'text/markdown',
      csv: 'text/csv',
    };

    res.setHeader('Content-Type', contentTypes[format] || 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="notes-export.${format === 'markdown' ? 'md' : format}"`);
    res.send(result.data);
  } catch (error) {
    console.error('Error exporting notes:', error);
    res.status(500).json({ error: 'Failed to export notes' });
  }
});

router.get('/entity/:entityId', async (req: Request<EntityParams>, res: Response): Promise<void> => {
  try {
    const notes = await getNotesByEntity(req.params.entityId);
    res.json({ notes, count: notes.length });
  } catch (error) {
    console.error('Error getting entity notes:', error);
    res.status(500).json({ error: 'Failed to get entity notes' });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      title,
      content,
      source_type,
      source_context,
      primary_entity_id,
      entity_ids,
      category,
      tags,
      is_pinned,
      color,
      create_memory,
    } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const validSourceTypes: NoteSourceType[] = ['manual', 'voice', 'chat', 'calendar_event'];
    if (source_type && !validSourceTypes.includes(source_type)) {
      res.status(400).json({ error: `Invalid source_type. Must be one of: ${validSourceTypes.join(', ')}` });
      return;
    }

    const note = await createNote({
      title,
      content,
      source_type,
      source_context,
      primary_entity_id,
      entity_ids,
      category,
      tags,
      is_pinned,
      color,
      create_memory,
    });

    res.status(201).json(note);
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.post('/:id/attachments', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const noteId = req.params.id;
    const { object_id, caption, position } = req.body;

    if (!object_id) {
      res.status(400).json({ error: 'object_id is required' });
      return;
    }

    const object = await getObjectById(object_id);
    if (!object || object.status !== 'active') {
      res.status(404).json({ error: 'Object not found' });
      return;
    }

    if (object.object_type !== 'image') {
      res.status(400).json({ error: 'Only image objects can be attached to notes' });
      return;
    }

    const note = await attachObjectToNote(noteId, object_id, {
      caption: caption ?? null,
      position: typeof position === 'number' ? position : undefined,
    });

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.status(201).json(note);
  } catch (error) {
    console.error('Error attaching object to note:', error);
    res.status(500).json({ error: 'Failed to attach image to note' });
  }
});

router.delete('/:id/attachments/:objectId', async (req: Request<AttachmentParams>, res: Response): Promise<void> => {
  try {
    const note = await detachObjectFromNote(req.params.id, req.params.objectId);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error removing object from note:', error);
    res.status(500).json({ error: 'Failed to remove image from note' });
  }
});

router.get('/:id', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const note = await getNote(req.params.id);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error getting note:', error);
    res.status(500).json({ error: 'Failed to get note' });
  }
});

router.patch('/:id', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const { title, content, primary_entity_id, entity_ids, category, tags, is_pinned, color } = req.body;

    const note = await updateNote(req.params.id, {
      title,
      content,
      primary_entity_id,
      entity_ids,
      category,
      tags,
      is_pinned,
      color,
    });

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.post('/:id/archive', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    await archiveNote(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error archiving note:', error);
    res.status(500).json({ error: 'Failed to archive note' });
  }
});

router.delete('/:id', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    await deleteNote(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

router.post('/:id/pin', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const note = await pinNote(req.params.id);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error pinning note:', error);
    res.status(500).json({ error: 'Failed to pin note' });
  }
});

router.post('/:id/unpin', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const note = await unpinNote(req.params.id);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error unpinning note:', error);
    res.status(500).json({ error: 'Failed to unpin note' });
  }
});

router.post('/:id/link', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const { entity_id, is_primary } = req.body;

    if (!entity_id) {
      res.status(400).json({ error: 'entity_id is required' });
      return;
    }

    const note = await linkNoteToEntity(req.params.id, entity_id, is_primary === true);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error linking note to entity:', error);
    res.status(500).json({ error: 'Failed to link note to entity' });
  }
});

router.post('/:id/unlink', async (req: Request<IdParams>, res: Response): Promise<void> => {
  try {
    const { entity_id } = req.body;

    if (!entity_id) {
      res.status(400).json({ error: 'entity_id is required' });
      return;
    }

    const note = await unlinkNoteFromEntity(req.params.id, entity_id);

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    console.error('Error unlinking note from entity:', error);
    res.status(500).json({ error: 'Failed to unlink note from entity' });
  }
});

export default router;
