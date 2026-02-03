import { listSyncEnabledAccounts } from '../../services/google/auth.js';
import { listUnread } from '../../services/google/gmail.js';

export const emailListToolName = 'email_list';

export const emailListToolDescription = 'List recent or unread emails from Gmail. Returns email subjects, senders, and snippets.';

export const emailListToolParameters = {
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: 'Maximum number of emails to return (default 10, max 20)',
    },
    unreadOnly: {
      type: 'boolean',
      description: 'Only show unread emails (default true)',
    },
  },
  required: [],
};

export async function emailListToolHandler(args: { limit?: number; unreadOnly?: boolean }): Promise<string> {
  try {
    const accounts = await listSyncEnabledAccounts();
    if (accounts.length === 0) {
      return 'No Google account connected. Please connect via settings.';
    }

    const account = accounts[0]!;
    const limit = Math.min(args.limit || 10, 20);

    const emails = await listUnread(account.id);
    const limited = emails.slice(0, limit);

    if (limited.length === 0) {
      return 'No unread emails.';
    }

    const formatted = limited.map((e, i) =>
      `${i + 1}. [${e.id}] From: ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet.substring(0, 100)}...`
    ).join('\n\n');

    return `Found ${limited.length} emails:\n\n${formatted}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
