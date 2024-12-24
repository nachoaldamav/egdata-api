import { Hono } from 'hono';
import client from '../clients/redis.js';
import { AchievementSet } from '@egdata/core.schemas.achievements';
import { Namespace } from '@egdata/core.schemas.namespace';
import { Item } from '@egdata/core.schemas.items';
import { Offer } from '@egdata/core.schemas.offers';
import { Asset } from '@egdata/core.schemas.assets';
import { db } from '../db/index.js';
import { PriceEngine } from '@egdata/core.schemas.price';
import { regions } from '../utils/countries.js';
import { getCookie } from 'hono/cookie';
import { orderOffersObject } from '../utils/order-offers-object.js';
import { Changelog } from '@egdata/core.schemas.changelog';
import { ObjectId } from 'mongodb';

const app = new Hono();

app.get('/', async (ctx) => {
  const start = Date.now();
  const page = Number.parseInt(ctx.req.query('page') || '1', 10);
  const limit = Math.min(
    Number.parseInt(ctx.req.query('limit') || '10', 10),
    100
  );
  const skip = (page - 1) * limit;

  const sandboxes = await Namespace.find(
    {},
    {
      _id: false,
      __v: false,
    },
    {
      skip,
      limit,
    }
  );

  const count = await Namespace.countDocuments();

  return ctx.json(
    {
      elements: sandboxes,
      page,
      limit,
      count,
    },
    200,
    {
      'Server-Timing': `db;dur=${Date.now() - start}`,
    }
  );
});

app.get('/:sandboxId', async (c) => {
  const { sandboxId } = c.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: 'Sandbox not found',
    });
  }

  return c.json(sandbox);
});

app.get('/:sandboxId/items', async (ctx) => {
  const { sandboxId } = ctx.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    ctx.status(404);

    return ctx.json({
      message: 'Sandbox not found',
    });
  }

  const items = await Item.find(
    {
      namespace: sandboxId,
    },
    undefined,
    {
      sort: {
        lastModified: -1,
      },
    }
  );

  return ctx.json(items, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:sandboxId/offers', async (ctx) => {
  const { sandboxId } = ctx.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    ctx.status(404);

    return ctx.json({
      message: 'Sandbox not found',
    });
  }

  const offers = await Offer.find(
    {
      namespace: sandboxId,
    },
    undefined,
    {
      sort: {
        lastModified: -1,
      },
    }
  );

  return ctx.json(offers);
});

app.get('/:sandboxId/assets', async (ctx) => {
  const { sandboxId } = ctx.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    ctx.status(404);

    return ctx.json({
      message: 'Sandbox not found',
    });
  }

  // const assets = await Asset.find(
  //   {
  //     namespace: sandboxId,
  //   },
  //   undefined,
  //   {
  //     sort: {
  //       lastModified: -1,
  //     },
  //   }
  // );
  const [assets, items] = await Promise.all([
    Asset.find(
      {
        namespace: sandboxId,
      },
      undefined,
      {
        sort: {
          lastModified: -1,
        },
      }
    ),
    Item.find(
      {
        namespace: sandboxId,
      },
      {
        id: 1,
        namespace: 1,
        releaseInfo: 1,
      }
    ),
  ]);

  const result = assets.map((a) => a.toObject());

  // Some assets are not found because they are protected or hidden, but we know they exist, so we add them to the result with 0 sizes
  for (const item of items) {
    for (const releaseInfo of item.releaseInfo) {
      if (!assets.find((a) => a.artifactId === releaseInfo.appId)) {
        for (const platform of releaseInfo.platform) {
          result.push({
            artifactId: releaseInfo.appId as string,
            downloadSizeBytes: 0,
            installedSizeBytes: 0,
            itemId: item.id,
            namespace: item.namespace,
            platform,
            _id: new ObjectId(),
          });
        }
      }
    }
  }

  return ctx.json(result);
});

app.get('/:sandboxId/base-game', async (c) => {
  const { sandboxId } = c.req.param();
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: 'Sandbox not found',
    });
  }

  const cacheKey = `base-game:${sandboxId}:${region}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  let baseGame = await Offer.findOne({
    namespace: sandboxId,
    offerType: 'BASE_GAME',
    prePurchase: { $ne: true },
    isCodeRedemptionOnly: false,
  });

  if (!baseGame) {
    // If no game found, try to find a pre-purchase game
    const prePurchaseGame = await Offer.findOne({
      namespace: sandboxId,
      offerType: 'BASE_GAME',
      prePurchase: true,
    });

    if (prePurchaseGame) {
      baseGame = prePurchaseGame;
    } else {
      // Try to find an "EXECUTABLE" item, with at least one asset
      const executableGame = await Item.findOne({
        namespace: sandboxId,
        entitlementType: 'EXECUTABLE',
        'releaseInfo.appId': { $ne: null },
      });

      if (executableGame) {
        return c.json({
          ...executableGame.toObject(),
          isItem: true,
        });
      }

      c.status(404);

      return c.json({
        message: 'Base game not found',
      });
    }
  }

  const price = await PriceEngine.findOne({
    offerId: baseGame.id,
    region,
  });

  const offer = {
    ...orderOffersObject(baseGame),
    price: price ?? null,
  };

  await client.set(cacheKey, JSON.stringify(offer), {
    EX: 3600,
  });

  return c.json(offer);
});

app.get('/:sandboxId/achievements', async (c) => {
  const { sandboxId } = c.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: 'Sandbox not found',
    });
  }

  const achievements = await AchievementSet.find({
    sandboxId: sandboxId,
  });

  return c.json(achievements);
});

app.get('/:sandboxId/changelog', async (c) => {
  const { sandboxId } = c.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: 'Sandbox not found',
    });
  }

  const [offers, items] = await Promise.all([
    Offer.find({
      namespace: sandboxId,
    }),
    Item.find({
      namespace: sandboxId,
    }),
  ]);

  const [offersIds, itemsIds] = await Promise.all([
    offers.map((o) => o.id),
    items.map((i) => i.id),
  ]);

  const changelist = await Changelog.find(
    {
      'metadata.contextId': { $in: [...offersIds, ...itemsIds, sandboxId] },
    },
    undefined,
    {
      sort: {
        timestamp: -1,
      },
    }
  );
  return c.json(changelist);
});

app.get('/:sandboxId/builds', async (c) => {
  const { sandboxId } = c.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: 'Sandbox not found',
    });
  }

  const items = await Item.find({
    namespace: sandboxId,
  });

  const builds = await db.db
    .collection('builds')
    .find({
      appName: {
        $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
      },
    })
    .toArray();

  return c.json(builds);
});

app.get('/:sandboxId/stats', async (c) => {
  const { sandboxId } = c.req.param();

  const sandbox = await db.db.collection('sandboxes').findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: 'Sandbox not found',
    });
  }

  const [offers, items, achievements] = await Promise.all([
    Offer.countDocuments({
      namespace: sandboxId,
    }),
    Item.find({
      namespace: sandboxId,
    }),
    AchievementSet.find({
      sandboxId,
    }),
  ]);

  const [assets, builds] = await Promise.all([
    Asset.countDocuments({
      namespace: sandboxId,
    }),
    db.db
      .collection('builds')
      .find({
        appName: {
          $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
        },
      })
      .toArray(),
  ]);

  return c.json({
    offers,
    items: items.length,
    assets,
    builds: builds.length,
    achievements: achievements.flatMap((a) => a.achievements).length,
  });
});

export default app;
