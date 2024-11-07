import { Hono } from 'hono';
import { db } from '../db/index.js';
import { Item } from '@egdata/core.schemas.items';
import { Asset } from '@egdata/core.schemas.assets';
import { type Filter, ObjectId, type Sort } from 'mongodb';
import type { AnyObject } from 'mongoose';

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
  const sort = c.req.query('sort') || 'depth';
  const direction = c.req.query('dir') || 'asc';

  // Get the extension(s) query parameter, expecting a comma-separated list if there are multiple
  const extensions = c.req.query('extension')?.split(',');

  const build = await db.db.collection('builds').findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  // Base query
  const query: Filter<AnyObject> = {
    manifestHash: build.hash,
  };

  const sortQuery: Sort = {};

  // If extensions are provided, use `$in` with a regex to match any of the extensions
  if (extensions) {
    query.fileName = {
      $regex: new RegExp(`\\.(${extensions.join('|')})$`, 'i'),
    };
  }

  if (sort === 'depth') {
    sortQuery.depth = direction === 'asc' ? 1 : -1;
    sortQuery.fileName = direction === 'asc' ? 1 : -1;
  } else if (sort === 'fileName') {
    sortQuery.fileName = direction === 'asc' ? 1 : -1;
  } else if (sort === 'fileSize') {
    sortQuery.fileSize = direction === 'asc' ? 1 : -1;
  }

  const files = await db.db
    .collection('files')
    .find(query)
    .sort(sortQuery)
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  const total = await db.db.collection('files').countDocuments(query);

  return c.json({
    files,
    page,
    limit,
    total,
  });
});

app.get('/:id/items', async (c) => {
  const { id } = c.req.param();

  const build = await db.db.collection('builds').findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  const items = await Item.find({
    'releaseInfo.appId': build.appName,
  });

  return c.json(items);
});

app.get('/:id/install-options', async (c) => {
  const { id } = c.req.param();

  const build = await db.db.collection('builds').findOne({
    _id: new ObjectId(id),
  });

  if (!build) {
    return c.json({ error: 'Build not found' }, 404);
  }

  const filesWithInstallOptions = await db.db
    .collection<{
      manifestHash: string;
      installTags: string[];
      fileHash: string;
      fileSize: number;
    }>('files')
    .find({
      manifestHash: build.hash,
      installTags: {
        $exists: true,
        $not: { $size: 0 },
      },
    })
    .toArray();

  const result: Record<
    string,
    {
      files: number;
      size: number;
    }
  > = {};

  for (const file of filesWithInstallOptions) {
    const installOptions = file.installTags.map((t) => t);

    for (const installOption of installOptions) {
      if (!result[installOption]) {
        result[installOption] = {
          files: 0,
          size: 0,
        };
      }

      result[installOption].files++;
      result[installOption].size += file.fileSize;
    }
  }

  return c.json(result);
});

export default app;
