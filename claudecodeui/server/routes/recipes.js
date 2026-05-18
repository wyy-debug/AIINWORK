import express from 'express';

import {
  buildRecipePrompt,
  getRecipe,
  listRecipes,
  runRecipe,
  validateRecipe,
} from '../services/recipe-service.js';

const router = express.Router();

router.get('/', (_req, res) => {
  try {
    res.json({ success: true, recipes: listRecipes() });
  } catch (error) {
    console.error('Recipe list error:', error);
    res.status(500).json({ error: error.message || 'Failed to list recipes' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const recipe = getRecipe(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    return res.json({ success: true, recipe });
  } catch (error) {
    console.error('Recipe get error:', error);
    return res.status(500).json({ error: error.message || 'Failed to load recipe' });
  }
});

router.post('/validate', (req, res) => {
  try {
    res.json({ success: true, ...validateRecipe(req.body?.recipe || req.body) });
  } catch (error) {
    console.error('Recipe validate error:', error);
    res.status(500).json({ error: error.message || 'Failed to validate recipe' });
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
    console.error('Recipe render error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to render recipe' });
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
    console.error('Recipe run error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to run recipe' });
  }
});

export default router;
