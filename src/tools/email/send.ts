import { listSyncEnabledAccounts } from '../../services/google/auth.js';
import { sendEmail } from '../../services/google/gmail.js';

export const emailSendToolName = 'email_send';

export const emailSendToolDescription = 'Compose and send an email. Requires recipient, subject, and body.';

export const emailSendToolParameters = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      description: 'Email subject line',
    },
    body: {
      type: 'string',
      description: 'Email body content (plain text)',
    },
  },
  required: ['to', 'subject', 'body'],
};

export async function emailSendToolHandler(args: { to: string; subject: string; body: string }): Promise<string> {
  try {
    const accounts = await listSyncEnabledAccounts();
    if (accounts.length === 0) {
      return 'No Google account connected.';
    }

    const success = await sendEmail(accounts[0]!.id, args.to, args.subject, args.body);

    if (success) {
      return `Email sent to ${args.to}.`;
    } else {
      return 'Failed to send email.';
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
