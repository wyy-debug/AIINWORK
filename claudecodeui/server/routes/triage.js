import express from 'express';

import { db } from '../database/db.js';

const router = express.Router();

const mapTriageItem = (row) => ({
  id: row.id,
  sourceType: row.source_type,
  sourceId: row.source_id || '',
  title: row.title,
  body: row.body || '',
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get('/', async (req, res) => {
  try {
    const status = String(req.query.status || 'open');
    const rows = db.prepare(`
      SELECT * FROM triage_items
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(status);
    res.json({ success: true, items: rows.map(mapTriageItem) });
  } catch (error) {
    console.error('Triage list error:', error);
    res.status(500).json({ error: error.message || 'Failed to load triage items' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const status = req.body?.status === 'closed' ? 'closed' : 'open';
    const changes = db.prepare(`
      UPDATE triage_items
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, req.params.id).changes;
    if (!changes) {
      return res.status(404).json({ error: 'Triage item not found' });
    }
    res.json({
      success: true,
      item: mapTriageItem(db.prepare('SELECT * FROM triage_items WHERE id = ?').get(req.params.id)),
    });
  } catch (error) {
    console.error('Triage update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update triage item' });
  }
});

export default router;
