import express from 'express';

import {
  createRecipeCatalogStore,
  getBuiltInRecipeCatalog,
  normalizeRecipeManifest,
  validateRecipePackage,
} from '../services/recipe-workflow-service.js';

const router = express.Router();
const recipeStore = createRecipeCatalogStore();

function sendRecipeError(res, error) {
  res.status(400).json({
    success: false,
    error: error?.message || 'Recipe request failed',
  });
}

router.get('/catalog', (req, res) => {
  void (async () => {
    try {
      res.json({ success: true, catalog: await recipeStore.listCatalog() });
    } catch (error) {
      sendRecipeError(res, error);
    }
  })();
});

router.get('/catalog/built-in', (req, res) => {
  try {
    res.json({ success: true, catalog: getBuiltInRecipeCatalog() });
  } catch (error) {
    sendRecipeError(res, error);
  }
});

router.post('/validate', (req, res) => {
  try {
    const recipe = normalizeRecipeManifest(req.body?.recipe || req.body || {});
    res.json({ success: true, recipe });
  } catch (error) {
    sendRecipeError(res, error);
  }
});

router.post('/packages/validate', (req, res) => {
  try {
    const recipePackage = validateRecipePackage(req.body?.package || req.body || {});
    res.json({ success: true, package: recipePackage });
  } catch (error) {
    sendRecipeError(res, error);
  }
});

router.post('/packages/import', async (req, res) => {
  try {
    const result = await recipeStore.importPackage(req.body?.package || req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendRecipeError(res, error);
  }
});

router.post('/packages/export', async (req, res) => {
  try {
    const recipePackage = await recipeStore.exportPackage(req.body?.recipeIds || req.body?.ids || []);
    res.json({ success: true, package: recipePackage });
  } catch (error) {
    sendRecipeError(res, error);
  }
});

export default router;
