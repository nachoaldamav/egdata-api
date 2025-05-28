import { Hono } from 'hono';
import { Item } from '@egdata/core.schemas.items';
import { attributesToObject } from '../utils/attributes-to-object.js';
import { Asset } from '@egdata/core.schemas.assets';
import { db } from '../db/index.js';
import client from '../clients/redis.js';
import { Offer } from '@egdata/core.schemas.offers';
import { OfferSubItems } from '@egdata/core.schemas.subitems';

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

app.get("/sitemap.xml", async (c) => {
  const cacheKey = "items-sitemap-index";
  const cacheTimeInSec = 3600 * 24; // 1 day
  const cacheStaleTimeInSec = cacheTimeInSec * 7; // 7 days
  const cached = false;
  const { page } = c.req.query();
  const limit = 1000;

  if (!page) {
    // Show the sitemap index, which contains the other sitemaps for all pages
    let siteMapIndex = "";

    if (cached) {
      siteMapIndex = cached;
    } else {
      const count = await Item.countDocuments();
      siteMapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${Array.from(
        { length: Math.ceil(count / limit) },
        (_, i) =>
          `<sitemap><loc>https://api.egdata.app/items/sitemap.xml?page=${i + 1}</loc><lastmod>${new Date().toISOString()}</lastmod></sitemap>`
      ).join("")}
</sitemapindex>`;

      await client.set(cacheKey, siteMapIndex, 'EX', cacheTimeInSec);
    }

    return c.text(siteMapIndex, 200, {
      "Content-Type": "application/xml",
      "Cache-Control": `max-age=${cacheTimeInSec}, stale-while-revalidate=${cacheStaleTimeInSec}`,
    });
  }

  // Generate individual sitemap page
  const cacheKeyPage = `items-sitemap-page-${page}`;
  const cachedPage = await client.get(cacheKeyPage);
  let siteMap = "";

  if (cachedPage) {
    siteMap = cachedPage;
  } else {
    const sections = [
      "assets",
      "builds",
      "images",
      "changelog",
    ];

    const items = await Item.find(
      {},
      { id: 1, lastModifiedDate: 1 },
      {
        limit,
        skip: (Number.parseInt(page, 10) - 1) * limit,
        sort: { lastModifiedDate: -1 },
      }
    );

    siteMap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${items
        .map((item) => {
          const url = `https://egdata.app/items/${item.id}`;
          return `<url>
        <loc>${url}</loc>
        <lastmod>${(item.lastModifiedDate as Date).toISOString()}</lastmod>
      </url>
      ${sections
              .map(
                (section) => `
      <url>
        <loc>${url}/${section}</loc>
        <lastmod>${(item.lastModifiedDate as Date).toISOString()}</lastmod>
      </url>
      `
              )
              .join("\n")}
      `;
        })
        .join("\n")}
</urlset>`;

    await client.set(cacheKeyPage, siteMap, 'EX', cacheTimeInSec);
  }

  return c.text(siteMap, 200, {
    "Content-Type": "application/xml",
    "Cache-Control": `max-age=${cacheTimeInSec}, stale-while-revalidate=${cacheStaleTimeInSec}`,
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
        downloadSizeBytes: build?.downloadSizeBytes ?? asset?.downloadSizeBytes,
        installedSizeBytes:
          build?.installedSizeBytes ?? asset?.installedSizeBytes,
      };
    })
  );

  return c.json(assets);
});

app.get("/:id/changelog", async (c) => {
  const { id } = c.req.param();

  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 50);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;

  const cacheKey = `changelog:${id}:${page}:${limit}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  // First get the item to ensure it exists
  const item = await Item.findOne({ id });
  if (!item) {
    c.status(404);
    return c.json({
      message: "Item not found",
    });
  }

  // Get assets for this item
  const assets = await Asset.find({ itemId: id });
  const assetIds = assets.map(a => a.artifactId);

  // Get builds for these assets
  const builds = await db.db.collection("builds").find({
    appName: { $in: assetIds }
  }).toArray();
  const buildIds = builds.map(b => b._id.toString());

  const allIds = [id, ...assetIds, ...buildIds];

  // Use aggregation pipeline for better performance
  const changelog = await db.db.collection("changelogs_v2").aggregate([
    {
      $match: {
        "metadata.contextId": { $in: allIds }
      }
    },
    {
      $sort: { timestamp: -1 }
    },
    {
      $skip: skip
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: "items",
        let: { contextId: "$metadata.contextId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$id", "$$contextId"] } } }
        ],
        as: "itemDoc"
      }
    },
    {
      $lookup: {
        from: "assets",
        let: { contextId: "$metadata.contextId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$artifactId", "$$contextId"] } } }
        ],
        as: "assetDoc"
      }
    },
    {
      $lookup: {
        from: "builds",
        let: { contextId: "$metadata.contextId" },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: "$_id" }, "$$contextId"] } } }
        ],
        as: "buildDoc"
      }
    },
    {
      $addFields: {
        document: {
          $switch: {
            branches: [
              { case: { $eq: ["$metadata.contextType", "item"] }, then: { $arrayElemAt: ["$itemDoc", 0] } },
              { case: { $eq: ["$metadata.contextType", "asset"] }, then: { $arrayElemAt: ["$assetDoc", 0] } },
              { case: { $eq: ["$metadata.contextType", "build"] }, then: { $arrayElemAt: ["$buildDoc", 0] } }
            ],
            default: null
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        metadata: 1,
        timestamp: 1,
        document: 1
      }
    }
  ]).toArray();

  // Cache the results
  await client.set(cacheKey, JSON.stringify(changelog), 'EX', 3600);

  return c.json(changelog, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/offer", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `offer:item:${id}`;
  const cached = await client.get(cacheKey);

  // Cache for 1 hour
  const CACHE_TTL = 60 * 60;

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
    });
  }

  const subItems = await OfferSubItems.find({
    'subItems.id': id,
  });

  const offers = await Offer.find({
    id: { $in: subItems.map((s) => s._id) },
    offerType: "BASE_GAME"
  });

  if (offers.length === 0) {
    return c.json({ error: "No offer found" }, 404);
  }

  if (offers.length === 1) {
    // Cache the result
    await client.set(cacheKey, JSON.stringify(offers[0]), 'EX', 3600);

    return c.json(offers[0], 200, {
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
    });
  }

  if (offers.length > 1) {
    // Return the first one that is not `prePurchase = true`
    const offer = offers.find((o) => !o.prePurchase);
    if (offer) {
      // Cache the result
      await client.set(cacheKey, JSON.stringify(offer), 'EX', 3600);

      return c.json(offer, 200, {
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
      });
    }
  }

  return c.json({ error: "No offer found" }, 404);
});

export default app;
