import { Hono } from 'hono';
import { Item } from '@egdata/core.schemas.items';
import { attributesToObject } from '../utils/attributes-to-object.js';
import { Asset } from '@egdata/core.schemas.assets';
import { db } from '../db/index.js';

const app = new Hono();

app.get('/', async (c) => {
  const MAX_LIMIT = 50;
  const limit = Math.min(
    Number.parseInt(c.req.query('limit') || '10'),
    MAX_LIMIT
  );
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);

  const items = await Item.find({}, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      lastModifiedDate: -1,
    },
  });

  return c.json({
    elements: items,
    page,
    limit,
    total: await Item.countDocuments(),
  });
});

type BulkBody = { items: string[] };

app.post('/bulk', async (c) => {
  const batch = (await c.req.json().catch((e) => {
    console.error(e);
    return {
      items: [],
    };
  })) as BulkBody;

  // Select only the items in the array that are a string, no objects, nulls, booleans, etc...
  const ids = batch.items.filter((id) => typeof id === 'string').slice(0, 100);

  const items = await Item.find({
    id: { $in: ids },
  });

  return c.json(
    items.map((item) => {
      return {
        ...item.toObject(),
        customAttributes: item.customAttributes
          ? attributesToObject(item.customAttributes as any)
          : {},
      };
    })
  );
});

app.get('/:id', async (c) => {
  const { id } = c.req.param();
  const item = await Item.findOne({
    $or: [{ _id: id }, { id: id }],
  });

  if (!item) {
    c.status(404);
    return c.json({
      message: 'Item not found',
    });
  }

  return c.json({
    ...item.toObject(),
    customAttributes: item.customAttributes
      ? attributesToObject(item.customAttributes as any)
      : {},
  });
});

app.get('/:id/assets', async (c) => {
  const { id } = c.req.param();

  const item = await Asset.find({
    itemId: id,
  });

  return c.json(item);
});

app.get('/:id/builds', async (c) => {
  const { id } = c.req.param();

  const item = await Item.findOne({
    id,
  });

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const builds = await db.db
    .collection('builds')
    .find({
      appName: {
        $in: item.releaseInfo.map((r) => r.appId),
      },
    })
    .toArray();

  const assets = await Promise.all(
    builds.map(async (build) => {
      const asset = await Asset.findOne({
        artifactId: build.appName,
        platform: build.labelName.split('-')[1],
      });

      return {
        ...build,
        downloadSizeBytes: asset?.downloadSizeBytes,
        installedSizeBytes: asset?.installedSizeBytes,
      };
    })
  );

  return c.json(assets);
});

export default app;
