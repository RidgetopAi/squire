import { Router, Request, Response } from 'express';
import {
  canViewDailyBriefReport,
  getDailyBriefReportById,
} from '../../services/daily-brief/reports.js';

const router = Router();

function sendMissing(res: Response): void {
  res.status(404).type('text/plain').send('Daily brief not found');
}

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;

    if (!id) {
      sendMissing(res);
      return;
    }

    const report = await getDailyBriefReportById(id);
    if (!report || !canViewDailyBriefReport(report, token)) {
      sendMissing(res);
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'"
    );
    res.send(report.html);
  } catch (error) {
    console.error('[DailyBrief] Failed to render public report:', error);
    res.status(500).type('text/plain').send('Failed to render daily brief');
  }
});

export default router;
