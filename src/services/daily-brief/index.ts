/**
 * Daily Brief Orchestrator
 *
 * Runs all brief modules, assembles the final HTML email, and sends it.
 */

import type { BriefModule, ModuleResult } from './types.js';
import { squireHealthModule } from './modules/squireHealth.js';
import { memoryHealthModule } from './modules/memoryHealth.js';
import { sendDailyBrief, getPrimaryAccount, getDailyBriefRecipient } from './emailer.js';
import { notify } from '../courier/notifier.js';
import { config } from '../../config/index.js';
import {
  buildDailyBriefReportUrl,
  markDailyBriefReportSent,
  saveDailyBriefReport,
} from './reports.js';

const COLORS = {
  headerBg: '#1a1a2e',
  accent: '#4f8ef7',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  text: '#1f2937',
  muted: '#6b7280',
  cardBg: '#f9fafb',
  white: '#ffffff',
  border: '#e5e7eb',
};

const modules: BriefModule[] = [squireHealthModule, memoryHealthModule];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateHeader(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function getTagline(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();

  const taglines: Record<number, string> = {
    0: 'Sunday briefing — memory and continuity check',
    1: 'Monday operator brief — what changed overnight',
    2: 'Tuesday operator brief — pipeline and continuity status',
    3: 'Midweek operator brief — what is healthy and what is lagging',
    4: 'Thursday operator brief — keep the system honest',
    5: 'Friday operator brief — watch the drift before the weekend',
    6: 'Saturday operator brief — where Squire stands right now',
  };

  return taglines[dayOfWeek] || 'Your daily briefing from Squire';
}

function renderAlertsBar(allAlerts: string[]): string {
  if (allAlerts.length === 0) return '';

  const alertItems = allAlerts
    .map(
      (alert) => `
      <div style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 0;">
        <span style="color: ${COLORS.warning}; font-size: 16px;">⚠</span>
        <span style="color: ${COLORS.text}; font-size: 14px;">${escapeHtml(alert)}</span>
      </div>
    `
    )
    .join('');

  return `
    <div style="background: ${COLORS.warning}10; border: 1px solid ${COLORS.warning}30; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
      <div style="font-weight: 600; color: ${COLORS.warning}; margin-bottom: 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
        Attention Needed
      </div>
      ${alertItems}
    </div>
  `;
}

function renderAtAGlance(moduleResults: ModuleResult[]): string {
  const summaryItems = moduleResults
    .flatMap((result) => result.summaryItems || [])
    .slice(0, 8);

  if (summaryItems.length === 0) return '';

  const items = summaryItems
    .map(
      (item) => `
        <li style="margin: 0 0 6px 0; color: ${COLORS.text}; font-size: 14px;">
          ${escapeHtml(item)}
        </li>
      `
    )
    .join('');

  return `
    <div style="background: ${COLORS.accent}10; border: 1px solid ${COLORS.accent}30; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
      <div style="font-weight: 600; color: ${COLORS.text}; margin-bottom: 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">
        At a Glance
      </div>
      <ul style="margin: 0; padding-left: 18px;">
        ${items}
      </ul>
    </div>
  `;
}

function renderModuleSection(result: ModuleResult): string {
  return `
    <div style="margin-bottom: 32px;">
      ${result.html}
    </div>
  `;
}

function buildEmailHtml(moduleResults: ModuleResult[]): string {
  const allAlerts = moduleResults.flatMap((r) => r.alerts || []);
  const moduleSections = moduleResults.map(renderModuleSection).join('\n');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Squire Daily Brief</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: ${COLORS.text}; background: ${COLORS.cardBg};">
  <div style="max-width: 760px; margin: 0 auto; background: ${COLORS.white};">
    <div style="background: ${COLORS.headerBg}; padding: 32px 24px; text-align: center;">
      <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; color: ${COLORS.white};">
        Squire Daily Brief
      </h1>
      <div style="font-size: 16px; color: ${COLORS.accent}; margin-bottom: 4px;">
        ${formatDateHeader()}
      </div>
      <div style="font-size: 14px; color: ${COLORS.muted}; font-style: italic;">
        ${getTagline()}
      </div>
    </div>

    <div style="padding: 24px;">
      ${renderAlertsBar(allAlerts)}
      ${renderAtAGlance(moduleResults)}
      ${moduleSections}
    </div>

    <div style="background: ${COLORS.cardBg}; padding: 16px 24px; text-align: center; border-top: 1px solid ${COLORS.border};">
      <div style="font-size: 12px; color: ${COLORS.muted};">
        Generated by Squire • ${formatTimestamp()}
      </div>
      <div style="font-size: 11px; color: ${COLORS.muted}; margin-top: 4px;">
        Operator view of memory, continuity, and support-model health
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

function buildTextSummary(moduleResults: ModuleResult[], alerts: string[]): string {
  const summaryItems = moduleResults.flatMap((result) => result.summaryItems || []);
  const lines = [
    `Squire Daily Brief - ${formatDateHeader()}`,
    '',
    `Modules: ${moduleResults.length}`,
    `Alerts: ${alerts.length}`,
  ];

  if (summaryItems.length > 0) {
    lines.push('', 'At a Glance:');
    lines.push(...summaryItems.slice(0, 8).map((item) => `- ${item}`));
  }

  if (alerts.length > 0) {
    lines.push('', 'Attention:');
    lines.push(...alerts.slice(0, 8).map((alert) => `- ${alert}`));
  }

  return lines.join('\n');
}

function stripTelegramMarkdown(value: string): string {
  return value.replace(/[*_`\[\]]/g, '');
}

function buildTelegramNotice(args: {
  moduleCount: number;
  alertCount: number;
  recipient: string;
  reportUrl?: string;
}): string {
  const lines = [
    '*Squire Daily Brief sent*',
    `To: ${stripTelegramMarkdown(args.recipient)}`,
    `Modules: ${args.moduleCount}`,
    `Alerts: ${args.alertCount}`,
  ];

  if (args.reportUrl) {
    lines.push('', `[Open brief](${args.reportUrl})`);
  }

  return lines.join('\n');
}

export async function generateDailyBrief(): Promise<{
  subject: string;
  html: string;
  textSummary: string;
  moduleCount: number;
  hasData: boolean;
  alerts: string[];
  moduleTitles: string[];
}> {
  console.log('[DailyBrief] Generating daily brief...');

  const results: ModuleResult[] = [];
  for (const module of modules) {
    try {
      console.log(`[DailyBrief] Running module: ${module.title}`);
      const result = await module.render();
      results.push(result);
      console.log(`[DailyBrief] Module ${module.title}: hasData=${result.hasData}, alerts=${result.alerts?.length || 0}`);
    } catch (error) {
      console.error(`[DailyBrief] Error in module ${module.title}:`, error);
      results.push({
        title: module.title,
        html: `<div style="color: ${COLORS.danger};">Error loading ${module.title}</div>`,
        hasData: false,
        alerts: [`Failed to load ${module.title}`],
      });
    }
  }

  const html = buildEmailHtml(results);
  const subject = `Squire Daily Brief — ${formatDateHeader()}`;
  const allAlerts = results.flatMap((r) => r.alerts || []);
  const hasData = results.some((r) => r.hasData);
  const textSummary = buildTextSummary(results, allAlerts);

  console.log(`[DailyBrief] Brief generated: ${results.length} modules, ${allAlerts.length} alerts`);

  return {
    subject,
    html,
    textSummary,
    moduleCount: results.length,
    hasData,
    alerts: allAlerts,
    moduleTitles: results.map((result) => result.title),
  };
}

export async function generateAndSendDailyBrief(): Promise<{
  success: boolean;
  message: string;
  recipient?: string;
}> {
  try {
    const account = await getPrimaryAccount();
    if (!account) {
      return {
        success: false,
        message: 'No Google account configured - cannot send daily brief',
      };
    }

    const recipient = getDailyBriefRecipient(account);
    const brief = await generateDailyBrief();
    let reportUrl: string | undefined;
    let reportId: string | undefined;

    try {
      const report = await saveDailyBriefReport({
        subject: brief.subject,
        html: brief.html,
        textSummary: brief.textSummary,
        moduleCount: brief.moduleCount,
        hasData: brief.hasData,
        alerts: brief.alerts,
        metadata: {
          moduleTitles: brief.moduleTitles,
          generatedAt: new Date().toISOString(),
        },
      });
      reportId = report.id;
      reportUrl = buildDailyBriefReportUrl(report);
    } catch (error) {
      console.error('[DailyBrief] Failed to persist report for Telegram link:', error);
    }

    const sent = await sendDailyBrief(brief.subject, brief.html, account);

    if (sent) {
      if (reportId) {
        await markDailyBriefReportSent(reportId).catch((error) => {
          console.error('[DailyBrief] Failed to mark report sent:', error);
        });
      }

      if (config.dailyBrief.telegramNotificationEnabled) {
        await notify(
          buildTelegramNotice({
            moduleCount: brief.moduleCount,
            alertCount: brief.alerts.length,
            recipient,
            reportUrl,
          }),
          {
            channels: ['telegram'],
            priority: brief.alerts.length > 0 ? 'high' : 'normal',
            sourceLoop: 'courier',
            metadata: {
              reportId,
              reportUrl,
              alertCount: brief.alerts.length,
            },
          }
        ).catch((error) => {
          console.error('[DailyBrief] Failed to send Telegram notice:', error);
        });
      }

      return {
        success: true,
        message: `Daily brief sent with ${brief.moduleCount} modules (${brief.alerts.length} alerts)`,
        recipient,
      };
    }

    return {
      success: false,
      message: 'Failed to send daily brief email',
    };
  } catch (error) {
    console.error('[DailyBrief] Error generating/sending brief:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export type { BriefModule, ModuleResult } from './types.js';
