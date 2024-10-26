import { Hono } from 'hono';
import { db } from '../db/index.js';
import { Item } from '../db/schemas/item.js';
import { Asset } from '../db/schemas/assets.js';
import { ObjectId } from 'mongodb';

const app = new Hono();

app.get('/:id', async (c) => {
  const { id } = c.req.param();

  const build = await db.db.collection('builds').findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  const asset = await Asset.findOne({
    artifactId: build.appName,
    platform: build.labelName.split('-')[1],
  });

  return c.json({
    ...build,
    downloadSizeBytes: asset?.downloadSizeBytes,
    installedSizeBytes: asset?.installedSizeBytes,
  });
});

app.get('/:id/files', async (c) => {
  const { id } = c.req.param();
  const limit = Number.parseInt(c.req.query('limit') || '25', 10);
  const page = Number.parseInt(c.req.query('page') || '1', 10);

  const build = await db.db.collection('builds').findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  const files = await db.db
    .collection('files')
    .find({
      manifestHash: build.hash,
    })
    .sort({ depth: 1, filename: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return c.json({
    files,
    page,
    limit,
    total: await db.db.collection('files').countDocuments({
      manifestHash: build.hash,
    }),
  });
});

app.get('/:hash/items', async (c) => {
  const { hash } = c.req.param();

  const build = await db.db.collection('builds').findOne({
    hash,
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  const items = await Item.find({
    'releaseInfo.appId': build.appName,
  });

  return c.json(items);
});

export default app;
