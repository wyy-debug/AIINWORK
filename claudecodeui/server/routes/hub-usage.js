import express from 'express';

import { hubUsageDb } from '../database/db.js';
import { getRequestIpAddress } from '../services/hub-usage-service.js';

const router = express.Router();

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

router.get('/', (req, res) => {
  try {
    const report = hubUsageDb.getDailyUsage({
      from: req.query.from,
      to: req.query.to,
      days: readPositiveInteger(req.query.days, 7),
    });
    res.json({ success: true, data: report });
  } catch (error) {
    console.error('[HubUsage] Failed to read usage report:', error);
    res.status(500).json({ success: false, error: 'Failed to read hub usage report' });
  }
});

router.post('/report', (req, res) => {
  try {
    const event = hubUsageDb.recordUsage({
      ...req.body,
      userId: req.user?.id ?? req.user?.userId ?? req.body?.userId ?? null,
      ipAddress: getRequestIpAddress(req),
    });
    res.json({ success: true, data: event });
  } catch (error) {
    console.error('[HubUsage] Failed to record usage event:', error);
    res.status(500).json({ success: false, error: 'Failed to record hub usage event' });
  }
});

export default router;
