import { Hono } from 'hono';
import { Asset } from '../db/schemas/assets.js';

const app = new Hono();

app.get('/:id', async (c) => {
  const id = c.req.param('id');

  if (!id) {
    return c.json({ error: 'Missing id parameter' }, 400);
  }

  const asset = await Asset.findOne({ artifactId: id });
  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }
  return c.json(asset);
});

export default app;
