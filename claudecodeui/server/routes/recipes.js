import express from 'express';

import {
  buildRecipePrompt,
  getRecipe,
  listRecipes,
  runRecipe,
  validateRecipe,
} from '../services/recipe-service.js';
import {
  createRecipeCatalogStore,
  getBuiltInRecipeCatalog,
  normalizeRecipeManifest,
  validateRecipePackage,
} from '../services/recipe-workflow-service.js';

const router = express.Router();
const recipeStore = createRecipeCatalogStore();

function sendRecipeError(res, error, fallbackStatus = 500, fallbackMessage = 'Recipe request failed') {
  console.error(fallbackMessage, error);
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

router.get('/catalog', async (_req, res) => {
  try {
    res.json({ success: true, catalog: await recipeStore.listCatalog() });
  } catch (error) {
    sendRecipeError(res, error, 400, 'Failed to list recipe catalog');
  }
});

router.get('/catalog/built-in', (_req, res) => {
  try {
    res.json({ success: true, catalog: getBuiltInRecipeCatalog() });
  } catch (error) {
    sendRecipeError(res, error, 400, 'Failed to list built-in recipe catalog');
  }
});

router.post('/packages/validate', (req, res) => {
  try {
    const recipePackage = validateRecipePackage(req.body?.package || req.body || {});
    res.json({ success: true, package: recipePackage });
  } catch (error) {
    sendRecipeError(res, error, 400, 'Failed to validate recipe package');
  }
});

router.post('/packages/import', async (req, res) => {
  try {
    const result = await recipeStore.importPackage(req.body?.package || req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    sendRecipeError(res, error, 400, 'Failed to import recipe package');
  }
});

router.post('/packages/export', async (req, res) => {
  try {
    const recipePackage = await recipeStore.exportPackage(req.body?.recipeIds || req.body?.ids || []);
    res.json({ success: true, package: recipePackage });
  } catch (error) {
    sendRecipeError(res, error, 400, 'Failed to export recipe package');
  }
});

router.get('/', (_req, res) => {
  try {
    res.json({ success: true, recipes: listRecipes() });
  } catch (error) {
    sendRecipeError(res, error, 500, 'Failed to list recipes');
  }
});

router.post('/validate', (req, res) => {
  try {
    const recipe = req.body?.recipe || req.body || {};
    if (Array.isArray(recipe?.steps) || recipe?.outputs) {
      return res.json({ success: true, recipe: normalizeRecipeManifest(recipe) });
    }
    return res.json({ success: true, ...validateRecipe(recipe) });
  } catch (error) {
    return sendRecipeError(res, error, 400, 'Failed to validate recipe');
  }
});

router.get('/:id', (req, res) => {
  try {
    const recipe = getRecipe(req.params.id);
    if (!recipe) {
      return res.status(404).json({ success: false, error: 'Recipe not found' });
    }
    return res.json({ success: true, recipe });
  } catch (error) {
    return sendRecipeError(res, error, 500, 'Failed to load recipe');
  }
});

router.post('/:id/render', (req, res) => {
  try {
    const result = buildRecipePrompt({
      recipeId: req.params.id,
      values: req.body?.values || {},
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendRecipeError(res, error, 500, 'Failed to render recipe');
  }
});

router.post('/:id/run', async (req, res) => {
  try {
    const result = await runRecipe({
      recipeId: req.params.id,
      values: req.body?.values || {},
      projectName: req.body?.projectName || req.body?.project || '',
      sessionId: req.body?.sessionId || '',
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendRecipeError(res, error, 500, 'Failed to run recipe');
  }
});

export default router;
