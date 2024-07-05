import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { inspectRoutes } from 'hono/dev';
import { getCookie } from 'hono/cookie';
import { etag } from 'hono/etag';
import { DB } from './db';
import { Offer, OfferType } from './db/schemas/offer';
import { Item } from './db/schemas/item';
import { orderOffersObject } from './utils/order-offers-object';
import { getFeaturedGames } from './utils/get-featured-games';
import { countries, regions } from './utils/countries';
import { Tags } from './db/schemas/tags';
import { attributesToObject } from './utils/attributes-to-object';
import { Asset } from './db/schemas/assets';
import { PriceEngine, PriceType } from './db/schemas/price-engine';
import { Changelog } from './db/schemas/changelog';
import client from './clients/redis';
import SandboxRoute from './routes/sandbox';
import SearchRoute from './routes/search';
import OffersRoute from './routes/offers';
import { config } from 'dotenv';
import { gaClient } from './clients/ga';

config();

const ALLOWED_ORIGINS = ['https://egdata.app', 'http://localhost:5173'];

const app = new Hono();

app.use(
  '/*',
  cors({
    origin: (origin: string) => {
      if (ALLOWED_ORIGINS.includes(origin)) {
        return origin;
      }

      return origin.endsWith('egdata.app') ? origin : 'https://egdata.app';
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST'],
    credentials: true,
    maxAge: 86400,
  })
);

const db = new DB();

db.connect();

app.use('/*', etag());

// app.use(logger());

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
  });
});

app.get('/', (c) => {
  return c.json({
    app: 'egdata',
    version: '0.0.1-alpha',
    endpoints: inspectRoutes(app)
      .filter(
        (x) => !x.isMiddleware && x.name === '[handler]' && x.path !== '/'
      )
      .sort((a, b) => {
        if (a.path !== b.path) {
          return a.path.localeCompare(b.path);
        }

        return a.method.localeCompare(b.method);
      })
      .map((x) => `${x.method} ${x.path}`),
  });
});

app.get('/sitemap.xml', async (c) => {
  const cacheKey = 'sitemap';
  const cacheTimeInSec = 3600 * 24; // 1 day
  const cacheStaleTimeInSec = cacheTimeInSec * 7; // 7 days
  const cached = await client.get(cacheKey);
  let siteMap = '';

  if (cached) {
    siteMap = cached;
  } else {
    siteMap = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const offers = await Offer.find(
        {},
        { id: 1, lastModifiedDate: 1 },
        {
          limit: pageSize,
          skip: page * pageSize,
          sort: { lastModifiedDate: -1 },
        }
      );

      hasMore = offers.length === pageSize;

      if (0 < offers.length) {
        offers.forEach((offer) => {
          siteMap += `
        <url>
          <loc>https://egdata.app/offers/${offer.id}</loc>
          <lastmod>${(offer.lastModifiedDate as Date).toISOString()}</lastmod>
        </url>`;
        });

        page++;
      }
    }

    siteMap += '</urlset>';

    await client.set(cacheKey, siteMap, {
      EX: cacheTimeInSec,
    });
  }

  return c.text(siteMap, 200, {
    'Content-Type': 'application/xml',
    'Cache-Control': `max-age=${cacheTimeInSec}, stale-while-revalidate=${cacheStaleTimeInSec}`,
  });
});

app.get('/items', async (c) => {
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

app.get('/items/:id', async (c) => {
  const { id } = c.req.param();
  const item = await Item.find({
    $or: [{ _id: id }, { id: id }],
  });

  if (!item || item.length === 0) {
    c.status(404);
    return c.json({
      message: 'Item not found',
    });
  }

  return c.json(item[0]);
});

app.get('/items-from-offer/:id', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `items-from-offer:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    console.log(`[CACHE] ${cacheKey} found`);
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  console.log(`[CACHE] ${cacheKey} not found`);

  const result = await Offer.aggregate([
    {
      $match: { id: id },
    },
    {
      $unwind: {
        path: '$items',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'items',
        localField: 'items.id',
        foreignField: 'id',
        as: 'itemDetails',
      },
    },
    {
      $unwind: {
        path: '$itemDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'items',
        let: { offerId: '$id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $isArray: '$linkedOffers' },
                  { $in: ['$$offerId', '$linkedOffers'] },
                ],
              },
            },
          },
        ],
        as: 'linkedItems',
      },
    },
    {
      $group: {
        _id: '$_id',
        offerItems: { $push: '$itemDetails' },
        linkedItems: { $first: '$linkedItems' },
      },
    },
    {
      $project: {
        _id: 0,
        items: {
          $filter: {
            input: { $concatArrays: ['$offerItems', '$linkedItems'] },
            as: 'item',
            cond: { $ne: ['$$item', null] },
          },
        },
      },
    },
  ]).exec();

  const items = result.flatMap((r) => r.items);

  const seen = new Set();
  const resultItems = items.filter((i) => {
    const duplicate = seen.has(i.id);
    seen.add(i.id);
    return !duplicate;
  });

  const res = resultItems.map((i) => {
    return {
      ...i,
      customAttributes: attributesToObject(i.customAttributes as any),
    };
  });

  await client.set(cacheKey, JSON.stringify(res), {
    // 1 week
    EX: 604800,
  });

  return c.json(res, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/latest-games', async (c) => {
  const start = new Date();
  const items = await Offer.find(
    {
      offerType: 'BASE_GAME',
    },
    undefined,
    {
      limit: 25,
      sort: {
        creationDate: -1,
      },
    }
  );
  const end = new Date();

  return c.json(
    items.map((i) => {
      return {
        id: i.id,
        namespace: i.namespace,
        title: i.title,
        description: i.description,
        lastModifiedDate: i.lastModifiedDate,
        effectiveDate: i.effectiveDate,
        creationDate: i.creationDate,
        keyImages: i.keyImages,
        productSlug: i.productSlug,
        urlSlug: i.urlSlug,
        url: i.url,
        tags: i.tags.map((t) => t.name),
        releaseDate: i.releaseDate,
        pcReleaseDate: i.pcReleaseDate,
        prePurchase: i.prePurchase,
        developerDisplayName: i.developerDisplayName,
        publisherDisplayName: i.publisherDisplayName,
        seller: i.seller?.name,
      };
    }),
    200,
    {
      'Cache-Control': 'public, max-age=60',
      'Server-Timing': `db;dur=${end.getTime() - start.getTime()}`,
    }
  );
});

app.get('/featured', async (c) => {
  const GET_FEATURED_GAMES_START = new Date();

  const cacheKey = `featured:v0.1`;
  const responseCacheKey = `featured-response:v0.1`;

  console.log(`[CACHE] ${cacheKey}`);

  const cachedResponse = await client.get(responseCacheKey);

  console.log(`[CACHE] ${responseCacheKey}`);

  if (cachedResponse) {
    console.log(`[CACHE] ${responseCacheKey} found`);
    return c.json(JSON.parse(cachedResponse), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  console.log(`[CACHE] ${responseCacheKey} not found`);

  const cached = await client.get(cacheKey);

  let featuredGames: { id: string; namespace: string }[] = [];

  if (cached) {
    console.log(`[CACHE] ${cacheKey} found`);
    featuredGames = JSON.parse(cached);
  } else {
    featuredGames = await getFeaturedGames();
    await client.set(cacheKey, JSON.stringify(featuredGames), {
      EX: 86400,
    });
  }

  const GET_FEATURED_GAMES_END = new Date();

  // Convert the featured games to the offer object
  const offers = await Offer.find(
    {
      id: { $in: featuredGames.map((f) => f.id) },
    },
    undefined,
    {
      sort: {
        lastModifiedDate: -1,
      },
    }
  );

  const result = offers.map((o) => orderOffersObject(o));

  await client.set(responseCacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(
    offers.map((o) => orderOffersObject(o)),
    200,
    {
      'Cache-Control': 'public, max-age=3600',
      'Server-Timing': `db;dur=${
        GET_FEATURED_GAMES_END.getTime() - GET_FEATURED_GAMES_START.getTime()
      }`,
    }
  );
});

app.get('/autocomplete', async (c) => {
  const query = c.req.query('query');

  if (!query) {
    return c.json({
      elements: [],
      total: 0,
    });
  }

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '5'), 5);

  const cacheKey = `autocomplete:${Buffer.from(query).toString(
    'base64'
  )}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    console.log(`[CACHE] ${cacheKey} found`);
    return c.json(JSON.parse(cached));
  }

  if (!query) {
    c.status(400);
    return c.json({
      message: 'Missing query parameter',
    });
  }

  const start = new Date();
  const offers = await Offer.find(
    {
      $text: {
        $search: query
          .split(' ')
          .map((q) => `"${q.trim()}"`)
          .join(' | '),
        $language: 'en',
      },
    },
    {
      title: 1,
      id: 1,
      namespace: 1,
      keyImages: 1,
    },
    {
      limit,
      collation: { locale: 'en', strength: 1 },
      sort: {
        score: { $meta: 'textScore' },
        offerType: -1,
        lastModifiedDate: -1,
      },
    }
  );

  const response = {
    elements: offers.map((o) => orderOffersObject(o)),
    total: await Offer.countDocuments(
      {
        $text: {
          $search: query
            .split(' ')
            .map((q) => `"${q.trim()}"`)
            .join(' | '),
        },
      },
      {
        collation: { locale: 'en', strength: 1 },
      }
    ),
  };

  if (response.elements.length > 0) {
    await client.set(cacheKey, JSON.stringify(response), {
      EX: 60,
    });
  }

  return c.json(response, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get('/countries', async (c) => {
  return c.json(countries);
});

app.get('/sales', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');
  const selectedCountry = country ?? cookieCountry ?? 'US';

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 30);
  const skip = (page - 1) * limit;

  const cacheKey = `sales:${region}:${page}:${limit}:v1.0`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
      'X-Cache': 'HIT',
    });
  }

  const start = new Date();

  const result = await PriceEngine.aggregate<
    Pick<
      OfferType,
      | 'id'
      | 'namespace'
      | 'title'
      | 'seller'
      | 'developerDisplayName'
      | 'publisherDisplayName'
      | 'keyImages'
      | 'lastModifiedDate'
      | 'offerType'
    > & { price: PriceType }
  >([
    {
      $match: {
        region,
        'price.discount': { $gt: 0 },
      },
    },
    {
      $lookup: {
        from: 'offers',
        localField: 'offerId',
        foreignField: 'id',
        as: 'offer',
      },
    },
    {
      $unwind: {
        path: '$offer',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: {
        updatedAt: -1,
      },
    },
    {
      $skip: skip,
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        id: '$offer.id',
        namespace: '$offer.namespace',
        title: '$offer.title',
        seller: '$offer.seller',
        developerDisplayName: '$offer.developerDisplayName',
        publisherDisplayName: '$offer.publisherDisplayName',
        keyImages: '$offer.keyImages',
        lastModifiedDate: '$offer.lastModifiedDate',
        offerType: '$offer.offerType',
        price: 1,
      },
    },
  ]);

  const count = await PriceEngine.countDocuments({
    'price.discount': { $gt: 0 },
    region,
  });

  const res = {
    elements: result.map((r) => {
      return {
        id: r.id,
        namespace: r.namespace,
        title: r.title,
        offerType: r.offerType,
        seller: r.seller,
        developerDisplayName: r.developerDisplayName,
        publisherDisplayName: r.publisherDisplayName,
        keyImages: r.keyImages,
        lastModifiedDate: r.lastModifiedDate,
        price: r.price,
      };
    }),
    page,
    limit,
    total: count,
  };

  await client.set(cacheKey, JSON.stringify(res), {
    EX: 3600,
  });

  return c.json(res, 200, {
    'Cache-Control': 'public, max-age=60',
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get('/base-game/:namespace', async (c) => {
  const { namespace } = c.req.param();

  const game = await Offer.findOne({
    namespace,
    offerType: 'BASE_GAME',
  });

  if (!game) {
    c.status(404);
    return c.json({
      message: 'Game not found',
    });
  }

  return c.json(orderOffersObject(game));
});

app.get('/changelog', async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const changelist = await Changelog.find({}, undefined, {
    limit,
    skip,
    sort: {
      timestamp: -1,
    },
  });

  return c.json(changelist, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/sellers', async (c) => {
  const sellers = await Offer.distinct('seller');

  return c.json(sellers);
});

app.get('/sellers/:id', async (c) => {
  const { id } = c.req.param();

  const isSimpleMetadata = c.req.query('full') !== 'true';

  const offers = await Offer.find(
    { 'seller.id': id },
    isSimpleMetadata ? { id: 1, title: 1, namespace: 1, offerType: 1 } : {}
  ).sort({
    lastModifiedDate: -1,
  });

  return c.json(offers);
});

app.get('/promotions', async (c) => {
  const events = await Tags.find({
    groupName: 'event',
    status: 'ACTIVE',
  });

  return c.json(events, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.get('/promotions/:id', async (c) => {
  const { id } = c.req.param();
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const selectedCountry = country ?? cookieCountry ?? 'US';

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const cacheKey = `promotion:${id}:${region}:${page}:${limit}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const event = await Tags.findOne({
    id,
    groupName: 'event',
  });

  if (!event) {
    c.status(404);
    return c.json({
      message: 'Event not found',
    });
  }

  /**
   * Tags is Array<{ id: string, name: string }>
   */
  const offers = await Offer.find(
    {
      tags: { $elemMatch: { id: id } },
    },
    undefined,
    {
      sort: {
        lastModifiedDate: -1,
      },
      limit,
      skip,
    }
  );

  const prices = await PriceEngine.find(
    {
      region,
      offerId: { $in: offers.map((o) => o.id) },
    },
    undefined,
    {
      sort: {
        date: -1,
      },
    }
  );

  const data = offers.map((o) => {
    const price = prices.find((p) => p?.offerId === o.id);
    if (!price) {
      console.warn(`Price not found for offer ${o.id}`);
    }
    return {
      id: o.id,
      namespace: o.namespace,
      title: o.title,
      seller: o.seller,
      keyImages: o.keyImages,
      developerDisplayName: o.developerDisplayName,
      publisherDisplayName: o.publisherDisplayName,
      releaseDate: o.releaseDate,
      prePurchase: o.prePurchase,
      price,
    };
  });

  const result: {
    elements: any[];
    title: string;
    limit: number;
    start: number;
    page: number;
    count: number;
  } = {
    elements: data,
    title: event.name ?? '',
    limit,
    start: skip,
    page,
    count: await Offer.countDocuments({
      tags: { $elemMatch: { id } },
    }),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/promotions/:id/cover', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `promotion-cover:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const offers = await Offer.find(
    {
      tags: { $elemMatch: { id } },
    },
    {
      namespace: 1,
      id: 1,
    }
  );

  const namespaces = offers.map((o) => o.namespace);

  const baseGame = await Offer.findOne(
    {
      namespace: { $in: namespaces },
      offerType: 'BASE_GAME',
    },
    {
      id: 1,
      namespace: 1,
      title: 1,
      keyImages: 1,
    }
  );

  if (!baseGame) {
    c.status(404);
    return c.json({
      message: 'Base game not found',
    });
  }

  await client.set(cacheKey, JSON.stringify(baseGame), {
    EX: 3600,
  });

  return c.json(baseGame, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/region', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  return c.json({
    region: { code: region, ...regions[region] },
  });
});

app.get('/changelist', async (ctx) => {
  const start = Date.now();

  const limit = Math.min(Number.parseInt(ctx.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(ctx.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const cacheKey = `changelist:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return ctx.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const changelist = await Changelog.find({}, undefined, {
    limit,
    skip,
    sort: {
      timestamp: -1,
    },
  });

  /**
   * Returns the affected offer, item, asset for each changelog
   */
  const elements = await Promise.all(
    changelist.map(async (change) => {
      switch (change.metadata.contextType) {
        case 'offer':
          return Offer.findOne(
            { id: change.metadata.contextId },
            {
              id: 1,
              title: 1,
              keyImages: 1,
              offerType: 1,
            }
          );
        case 'item':
          return Item.findOne(
            { id: change.metadata.contextId },
            {
              id: 1,
              title: 1,
              keyImages: 1,
            }
          );
        case 'asset':
          return Asset.findOne(
            { id: change.metadata.contextId },
            {
              id: 1,
              artifactId: 1,
            }
          );
        default:
          return null;
      }
    })
  );

  const result = changelist.map((change) => {
    const element = elements.find(
      (e) => e?.toObject().id === change.metadata.contextId
    );

    return {
      ...change.toObject(),
      metadata: {
        ...change.toObject().metadata,
        context: element?.toObject(),
      },
    };
  });

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return ctx.json(result, 200, {
    'Server-Timing': `db;dur=${Date.now() - start}`,
    'Cache-Control': 'public, max-age=60',
  });
});

app.post('/ping', async (c) => {
  const body = await c.req.json();

  await gaClient.track(body);

  return c.json({ message: 'pong' });
});

app.get('/ping', async (c) => {
  return c.json({ message: 'pong' });
});

app.options('/ping', async (c) => {
  return c.json({ message: 'pong' });
});

app.route('/sandboxes', SandboxRoute);

app.route('/search', SearchRoute);

app.route('/offers', OffersRoute);

serve(
  {
    fetch: app.fetch,
    port: 4000,
  },
  (info) => {
    console.log(`Server running at ${info.address}:${info.port}`);
  }
);
