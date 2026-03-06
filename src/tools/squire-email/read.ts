import type { ToolHandler, ToolSpec } from '../types.js';
import { agentmail } from '../../services/agentmail.js';

async function squireEmailReadToolHandler(args: { message_id: string }): Promise<string> {
  try {
    if (!args.message_id) {
      return 'Error: message_id is required';
    }

    const msg = await agentmail.getMessage(args.message_id);

    const date = new Date(msg.timestamp).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
    });
    const from = msg.from.map(f => f.name ? `${f.name} <${f.email}>` : f.email).join(', ');
    const to = msg.to.map(t => t.name ? `${t.name} <${t.email}>` : t.email).join(', ');

    let result = `Message ID: ${msg.message_id}\n`;
    result += `Date: ${date}\n`;
    result += `From: ${from}\n`;
    result += `To: ${to}\n`;
    result += `Subject: ${msg.subject}\n`;
    if (msg.thread_id) {
      result += `Thread: ${msg.thread_id}\n`;
    }
    result += `\n${'─'.repeat(60)}\n\n`;
    result += msg.text || msg.html || '(no content)';

    return result;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const tools: ToolSpec[] = [
  {
    name: 'squire_email_read',
    description: 'Read the full content of a specific email from Squire\'s inbox. Use the message_id from squire_email_list.',
    parameters: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'The message ID to read',
        },
      },
      required: ['message_id'],
    },
    handler: squireEmailReadToolHandler as ToolHandler,
  },
];
