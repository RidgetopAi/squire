import { runNow } from '../../services/courier/index.js';

export const emailCheckToolName = 'email_check';

export const emailCheckToolDescription = 'Manually trigger an email check. This runs the Courier email check task immediately.';

export const emailCheckToolParameters = {
  type: 'object',
  properties: {},
  required: [],
};

export async function emailCheckToolHandler(): Promise<string> {
  try {
    await runNow();
    return 'Email check triggered. Summary will be sent shortly.';
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
