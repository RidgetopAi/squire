import { listSyncEnabledAccounts } from '../../services/google/auth.js';
import { archiveEmail } from '../../services/google/gmail.js';

export const emailArchiveToolName = 'email_archive';

export const emailArchiveToolDescription = 'Archive an email (remove from inbox but keep in All Mail). Use email_list first to get email IDs.';

export const emailArchiveToolParameters = {
  type: 'object',
  properties: {
    emailId: {
      type: 'string',
      description: 'The email ID to archive (from email_list results)',
    },
  },
  required: ['emailId'],
};

export async function emailArchiveToolHandler(args: { emailId: string }): Promise<string> {
  try {
    const accounts = await listSyncEnabledAccounts();
    if (accounts.length === 0) {
      return 'No Google account connected.';
    }

    const success = await archiveEmail(accounts[0]!.id, args.emailId);

    if (success) {
      return 'Email archived.';
    } else {
      return 'Failed to archive email.';
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
