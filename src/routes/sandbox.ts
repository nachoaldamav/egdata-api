import { Hono } from 'hono';
import type mongoose from 'mongoose';
import client from '../clients/redis.js';
import { AchievementSet } from '../db/schemas/achievements.js';
import { Namespace } from '../db/schemas/namespace.js';
import { Item } from '../db/schemas/item.js';
import { Offer } from '../db/schemas/offer.js';
import { Asset } from '../db/schemas/assets.js';
import { db } from '../db/index.js';
import { PriceEngine } from '../db/schemas/price-engine.js';
import { regions } from '../utils/countries.js';
import { getCookie } from 'hono/cookie';
import { orderOffersObject } from '../utils/order-offers-object.js';
import { Changelog } from '../db/schemas/changelog.js';

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

app.get('/:sandboxId/achievements', async (ctx) => {
  const start = Date.now();
  const { sandboxId } = ctx.req.param();

  const cacheKey = `sandbox:${sandboxId}:achivement-sets`;
  const cached = await client.get(cacheKey);

  let achievementSets: mongoose.InferRawDocType<typeof AchievementSet>[] = [];

  if (cached) {
    achievementSets = JSON.parse(cached);
  } else {
    const sandbox = await Namespace.findOne({
      namespace: sandboxId,
    });

    if (!sandbox) {
      ctx.status(404);

      return ctx.json({
        message: 'Sandbox not found',
      });
    }

    achievementSets = await AchievementSet.find(
      {
        sandboxId,
      },
      {
        _id: false,
        __v: false,
      }
    );

    await client.set(cacheKey, JSON.stringify(achievementSets), {
      EX: 1800, // 30min
    });
  }

  return ctx.json(
    {
      sandboxId,
      achievementSets,
    },
    200,
    {
      'Server-Timing': `db;dur=${Date.now() - start}`,
    }
  );
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
    {
      _id: 0,
      id: 1,
      title: 1,
      description: 1,
      namespace: 1,
      offerType: 1,
      effectiveDate: 1,
      creationDate: 1,
      lastModifiedDate: 1,
      keyImages: 1,
      productSlug: 1,
      releaseDate: 1,
    },
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

  const assets = await Asset.find(
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

  return ctx.json(assets);
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

  const cacheKey = `base-game:${sandboxId}:${region}`;

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

export default app;
