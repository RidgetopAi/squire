import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const {
  buildDailyBriefReportUrl,
  canViewDailyBriefReport,
} = await import('../src/services/daily-brief/reports.js');

describe('daily brief report links', () => {
  it('builds a token-protected URL from the public Squire base', () => {
    const url = buildDailyBriefReportUrl(
      { id: '2a2e1dd1-7e23-4c2e-8776-1d75576483c2', publicToken: 'abc123' },
      'https://squire.example.com/'
    );

    assert.equal(
      url,
      'https://squire.example.com/daily-briefs/2a2e1dd1-7e23-4c2e-8776-1d75576483c2?token=abc123'
    );
  });

  it('requires the exact public token to view a report', () => {
    const report = { publicToken: 'abc123' };

    assert.equal(canViewDailyBriefReport(report, undefined), false);
    assert.equal(canViewDailyBriefReport(report, 'abc'), false);
    assert.equal(canViewDailyBriefReport(report, 'wrong1'), false);
    assert.equal(canViewDailyBriefReport(report, 'abc123'), true);
  });
});
