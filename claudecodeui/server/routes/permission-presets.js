import express from 'express';

import {
  listPermissionPresets,
  resolvePermissionPresetRuntime,
} from '../services/permission-preset-service.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, presets: listPermissionPresets() });
});

router.post('/resolve', (req, res) => {
  try {
    res.json({
      success: true,
      runtime: resolvePermissionPresetRuntime(req.body?.permissionPreset || req.body?.preset, req.body?.baseOptions || {}),
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error?.message || 'Failed to resolve permission preset' });
  }
});

export default router;
