import { randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../../config/index.js';
import { pool } from '../../db/pool.js';

export interface DailyBriefReport {
  id: string;
  subject: string;
  html: string;
  textSummary: string;
  moduleCount: number;
  hasData: boolean;
  alerts: string[];
  metadata: Record<string, unknown>;
  publicToken: string;
  sentAt: Date | null;
  createdAt: Date;
}

export interface SaveDailyBriefReportInput {
  subject: string;
  html: string;
  textSummary: string;
  moduleCount: number;
  hasData: boolean;
  alerts: string[];
  metadata?: Record<string, unknown>;
}

function generatePublicToken(): string {
  return randomBytes(24).toString('hex');
}

function mapReportRow(row: Record<string, unknown>): DailyBriefReport {
  const alerts = Array.isArray(row.alerts) ? row.alerts : [];
  return {
    id: String(row.id),
    subject: String(row.subject ?? ''),
    html: String(row.html ?? ''),
    textSummary: String(row.text_summary ?? ''),
    moduleCount: Number(row.module_count ?? 0),
    hasData: Boolean(row.has_data),
    alerts: alerts.map(String),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    publicToken: String(row.public_token ?? ''),
    sentAt: row.sent_at ? new Date(String(row.sent_at)) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

export function buildDailyBriefReportUrl(
  report: Pick<DailyBriefReport, 'id' | 'publicToken'>,
  baseUrl = config.dailyBrief.publicBaseUrl
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = new URL(`/daily-briefs/${encodeURIComponent(report.id)}`, normalizedBase);
  url.searchParams.set('token', report.publicToken);
  return url.toString();
}

export function canViewDailyBriefReport(
  report: Pick<DailyBriefReport, 'publicToken'>,
  token: string | undefined
): boolean {
  if (!token || token.length !== report.publicToken.length) return false;

  return timingSafeEqual(
    Buffer.from(token, 'utf8'),
    Buffer.from(report.publicToken, 'utf8')
  );
}

export async function saveDailyBriefReport(
  input: SaveDailyBriefReportInput
): Promise<DailyBriefReport> {
  const result = await pool.query(
    `INSERT INTO daily_brief_reports (
      subject, html, text_summary, module_count, has_data, alerts, metadata, public_token
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      input.subject,
      input.html,
      input.textSummary,
      input.moduleCount,
      input.hasData,
      JSON.stringify(input.alerts),
      JSON.stringify(input.metadata ?? {}),
      generatePublicToken(),
    ]
  );

  return mapReportRow(result.rows[0]);
}

export async function markDailyBriefReportSent(id: string): Promise<void> {
  await pool.query(
    `UPDATE daily_brief_reports
     SET sent_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

export async function getDailyBriefReportById(id: string): Promise<DailyBriefReport | null> {
  const result = await pool.query(
    `SELECT *
     FROM daily_brief_reports
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;
  return mapReportRow(result.rows[0]);
}

export async function getLatestDailyBriefReport(): Promise<DailyBriefReport | null> {
  const result = await pool.query(
    `SELECT *
     FROM daily_brief_reports
     ORDER BY created_at DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) return null;
  return mapReportRow(result.rows[0]);
}
