/**
 * Lesson Tools - store and search agent lessons
 *
 * Tools for managing lessons learned from experience.
 * - lesson_store: Store a lesson learned
 * - lesson_search: Search for relevant lessons
 */

import { storeLesson, searchLessons } from '../../services/memory/index.js';
import type { ToolHandler } from '../types.js';
import type { LessonStoreArgs, LessonSearchArgs } from './types.js';

// === lesson_store ===

export const lessonStoreToolName = 'lesson_store';

export const lessonStoreToolDescription =
  'Store a lesson learned from experience. Use when you discover a pattern that worked, a mistake to avoid, a correction from Brian, or a technical insight worth remembering.';

export const lessonStoreToolParameters = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'The lesson content - what was learned',
    },
    trigger: {
      type: 'string',
      description: 'What prompted this lesson (optional)',
    },
    category: {
      type: 'string',
      description: 'Category: coding, communication, process, technical, preference (optional)',
    },
    importance: {
      type: 'number',
      description: 'Importance 1-10, default 5 (optional)',
    },
  },
  required: ['content'],
};

export const lessonStoreToolHandler: ToolHandler<LessonStoreArgs> = async (args) => {
  try {
    const { content, trigger, category, importance } = args;
    const lesson = await storeLesson(content, trigger, category, importance);
    return JSON.stringify({
      message: 'Lesson stored successfully',
      id: lesson.id,
      content: lesson.content,
      category: lesson.category,
      importance: lesson.importance,
    });
  } catch (error) {
    return `Failed to store lesson: ${error instanceof Error ? error.message : String(error)}`;
  }
};

// === lesson_search ===

export const lessonSearchToolName = 'lesson_search';

export const lessonSearchToolDescription =
  'Search for relevant lessons from past experience. Lessons are auto-injected into context, but you can search manually for specific topics.';

export const lessonSearchToolParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query to find relevant lessons',
    },
    limit: {
      type: 'number',
      description: 'Max results to return (default 5)',
    },
  },
  required: ['query'],
};

export const lessonSearchToolHandler: ToolHandler<LessonSearchArgs> = async (args) => {
  try {
    const { query, limit } = args;
    const lessons = await searchLessons(query, limit ?? 5);

    if (lessons.length === 0) {
      return 'No lessons found matching that query.';
    }

    const formatted = lessons
      .map(
        (l, i) =>
          `${i + 1}. [${l.category || 'general'}] ${l.content}${l.trigger ? ` (trigger: ${l.trigger})` : ''}`
      )
      .join('\n');

    return `Found ${lessons.length} lessons:\n${formatted}`;
  } catch (error) {
    return `Failed to search lessons: ${error instanceof Error ? error.message : String(error)}`;
  }
};
