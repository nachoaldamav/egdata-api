import { Hono } from 'hono';
import { db } from '../db/index.js';

const app = new Hono();

app.get('/:hash', async (c) => {
  const { hash } = c.req.param();

  const build = await db.db.collection('builds').findOne({
    hash,
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  return c.json(build);
});

app.get('/:hash/files', async (c) => {
  const { hash } = c.req.param();
  const limit = Number.parseInt(c.req.query('limit') || '25', 10);
  const page = Number.parseInt(c.req.query('page') || '1', 10);

  const build = await db.db.collection('builds').findOne({
    hash,
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  const files = await db.db
    .collection('files')
    .find({
      manifestHash: hash,
    })
    .sort({ depth: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return c.json(files);
});

export default app;
