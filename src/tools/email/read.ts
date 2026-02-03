import { listSyncEnabledAccounts } from '../../services/google/auth.js';
import { getEmail } from '../../services/google/gmail.js';

export const emailReadToolName = 'email_read';

export const emailReadToolDescription = 'Read the full content of a specific email by its ID. Use email_list first to get email IDs.';

export const emailReadToolParameters = {
  type: 'object',
  properties: {
    emailId: {
      type: 'string',
      description: 'The email ID to read (from email_list results)',
    },
  },
  required: ['emailId'],
};

export async function emailReadToolHandler(args: { emailId: string }): Promise<string> {
  try {
    const accounts = await listSyncEnabledAccounts();
    if (accounts.length === 0) {
      return 'No Google account connected.';
    }

    const email = await getEmail(accounts[0]!.id, args.emailId);

    const formatted = `From: ${email.from}
To: ${email.to.join(', ')}
${email.cc?.length ? `Cc: ${email.cc.join(', ')}\n` : ''}Date: ${email.date.toLocaleString()}
Subject: ${email.subject}

${email.body}`;

    return formatted;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
