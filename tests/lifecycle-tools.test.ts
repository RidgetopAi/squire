import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const [
  notesModule,
  listsModule,
  remindersModule,
  calendarModule,
  commitmentsModule,
] = await Promise.all([
  import('../src/tools/notes.js'),
  import('../src/tools/lists.js'),
  import('../src/tools/reminders.js'),
  import('../src/tools/calendar.js'),
  import('../src/tools/commitments.js'),
]);

type ToolSpec = {
  name: string;
  description: string;
  parameters: {
    properties?: Record<string, unknown>;
  };
};

const allTools = [
  ...notesModule.tools,
  ...listsModule.tools,
  ...remindersModule.tools,
  ...calendarModule.tools,
  ...commitmentsModule.tools,
] as ToolSpec[];

function tool(name: string): ToolSpec {
  const match = allTools.find((candidate) => candidate.name === name);
  assert.ok(match, `Expected tool "${name}" to be registered`);
  return match;
}

function properties(name: string): Record<string, unknown> {
  return tool(name).parameters.properties ?? {};
}

function assertHasProperties(name: string, expected: string[]): void {
  const props = properties(name);
  for (const key of expected) {
    assert.ok(key in props, `${name} should expose ${key}`);
  }
}

function assertMentionsAmbiguity(name: string): void {
  assert.match(
    tool(name).description.toLowerCase(),
    /ambig|uncertain|fuzzy|matching/,
    `${name} should advertise ambiguity/fuzzy matching behavior`
  );
}

describe('lifecycle mutation tool contract', () => {
  it('registers the note mutation tools', () => {
    for (const name of [
      'update_note',
      'update_note_metadata',
      'replace_note_section',
      'archive_note',
      'delete_note',
      'remove_note_attachment',
    ]) {
      tool(name);
      assertHasProperties(name, ['note_id', 'note_title']);
    }

    assertMentionsAmbiguity('update_note');
    assert.match(tool('delete_note').description.toLowerCase(), /permanent/);
  });

  it('registers the list lifecycle tools', () => {
    for (const name of ['update_list', 'archive_list', 'delete_list', 'clear_completed_list_items']) {
      tool(name);
      assertHasProperties(name, ['list_id', 'list_name']);
    }

    for (const name of ['update_list_item', 'delete_list_item', 'move_list_item']) {
      tool(name);
      assertHasProperties(name, ['list_id', 'list_name', 'item_id', 'item_content']);
    }

    assertHasProperties('reorder_list_items', ['list_id', 'list_name', 'item_ids']);
    assertMentionsAmbiguity('update_list');
  });

  it('registers reminder mutation tools with safe cancellation and snooze support', () => {
    assertHasProperties('update_reminder', [
      'reminder_id',
      'reminder_title',
      'title',
      'body',
      'scheduled_at',
      'status',
      'snooze_until',
      'snooze_minutes',
    ]);
    assertHasProperties('delete_reminder', ['reminder_id', 'reminder_title', 'permanent']);

    assertMentionsAmbiguity('update_reminder');
    assert.match(tool('delete_reminder').description.toLowerCase(), /default behavior is safe cancel/);
  });

  it('registers calendar event mutation tools with schedule and location support', () => {
    assertHasProperties('create_calendar_event', ['title', 'start_time', 'duration_minutes', 'location']);
    assertHasProperties('update_calendar_event', [
      'calendar_event_id',
      'event_id',
      'event_title',
      'title',
      'description',
      'location',
      'start_time',
      'duration_minutes',
      'all_day',
    ]);
    assertHasProperties('delete_calendar_event', ['calendar_event_id', 'event_id', 'event_title']);

    assertMentionsAmbiguity('update_calendar_event');
    assert.match(tool('delete_calendar_event').description.toLowerCase(), /cancel|delete/);
  });

  it('registers commitment lifecycle tools with status, snooze, cancel, and delete support', () => {
    assertHasProperties('create_commitment', ['title', 'description', 'due_at', 'status']);
    assertHasProperties('update_commitment', [
      'commitment_id',
      'commitment_title',
      'title_match',
      'title',
      'description',
      'due_at',
      'status',
      'snooze_until',
      'resolution_type',
    ]);
    assertHasProperties('cancel_commitment', ['commitment_id', 'commitment_title', 'title_match', 'resolution_type']);
    assertHasProperties('delete_commitment', ['commitment_id', 'commitment_title', 'title_match']);

    assertMentionsAmbiguity('update_commitment');
    assert.match(tool('delete_commitment').description.toLowerCase(), /permanent/);
  });
});
