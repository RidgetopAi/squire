import { config } from '../../config/index.js';
import { broadcastEmailSummary } from '../../api/socket/broadcast.js';
import type { EmailSummary } from './summarizer.js';

export interface NotifyOptions {
  channels?: ('telegram' | 'webapp')[];
  priority?: 'normal' | 'high';
}

async function sendTelegram(message: string): Promise<void> {
  const token = config.telegram.botToken;
  const chatIds = config.telegram.allowedUserIds;

  if (!token || chatIds.length === 0) {
    console.log('[Notifier] Telegram not configured, skipping');
    return;
  }

  for (const chatId of chatIds) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        console.error(`[Notifier] Telegram error for ${chatId}:`, await response.text());
      }
    } catch (error) {
      console.error(`[Notifier] Telegram send failed for ${chatId}:`, error);
    }
  }
}

export async function notify(message: string, options: NotifyOptions = {}): Promise<void> {
  const channels = options.channels || ['telegram', 'webapp'];

  if (channels.includes('telegram')) {
    await sendTelegram(message);
  }

  if (channels.includes('webapp')) {
    // Generic broadcast - could add a generic notification event
    console.log('[Notifier] Webapp notification:', message.substring(0, 50));
  }
}

export async function notifyEmailSummary(emails: EmailSummary[]): Promise<void> {
  if (emails.length === 0) {
    console.log('[Notifier] No emails to notify');
    return;
  }

  // Build message
  const header = `📧 *Email Summary* (${emails.length} new)\n\n`;
  const body = emails.map(e => e.summary).join('\n');
  const footer = '\n\n_Reply "check email" for details_';
  const message = header + body + footer;

  // Send to Telegram
  await sendTelegram(message);

  // Broadcast to webapp via Socket.IO
  broadcastEmailSummary({
    count: emails.length,
    emails: emails.map(e => ({
      from: e.from,
      subject: e.subject,
      summary: e.summary,
    })),
  });

  console.log(`[Notifier] Email summary sent: ${emails.length} emails`);
}

export async function notifyNoEmails(): Promise<void> {
  // Optional: notify when no new emails
  // For now, just log it
  console.log('[Notifier] No new emails');
}
