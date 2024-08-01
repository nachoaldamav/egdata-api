import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { inspectRoutes } from 'hono/dev';
import { getCookie } from 'hono/cookie';
import { etag } from 'hono/etag';
import { db } from './db';
import { Offer, OfferType } from './db/schemas/offer';
import { Item } from './db/schemas/item';
import { orderOffersObject } from './utils/order-offers-object';
import { getFeaturedGames } from './utils/get-featured-games';
import { countries, regions } from './utils/countries';
import { TagModel, Tags } from './db/schemas/tags';
import { attributesToObject } from './utils/attributes-to-object';
import { Asset } from './db/schemas/assets';
import { PriceEngine, PriceType } from './db/schemas/price-engine';
import { Changelog } from './db/schemas/changelog';
import client from './clients/redis';
import SandboxRoute from './routes/sandbox';
import SearchRoute from './routes/search';
import OffersRoute from './routes/offers';
import PromotionsRoute from './routes/promotions';
import FreeGamesRoute from './routes/free-games';
import { config } from 'dotenv';
import { gaClient } from './clients/ga';
import { Event } from './db/schemas/events';
import { meiliSearchClient } from './clients/meilisearch';

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

  const sections = [
    'items',
    'achievements',
    'related',
    'metadata',
    'changelog',
    'media',
  ];

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
        </url>
        ${sections
          .map(
            (section) => `
        <url>
          <loc>https://egdata.app/offers/${offer.id}/${section}</loc>
          <lastmod>${(offer.lastModifiedDate as Date).toISOString()}</lastmod>
        </url>
        `
          )
          .join('')}
        `;
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

app.get('/promotions-sitemap.xml', async (c) => {
  const cacheKey = 'promotions-sitemap';
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
      const tags = await TagModel.find(
        { groupName: 'event', referenceCount: { $gt: 0 } },
        undefined,
        {
          limit: pageSize,
          skip: page * pageSize,
          sort: { updated: -1 },
        }
      );

      hasMore = tags.length === pageSize;

      if (0 < tags.length) {
        tags.forEach((tag) => {
          siteMap += `
        <url>
          <loc>https://egdata.app/promotions/${tag.id}</loc>
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

app.get('/robots.txt', async (c) => {
  // Disallow all robots as this is an API (Besides the sitemap)
  const robots = `User-agent: *
Disallow: /
Allow: /sitemap.xml
Allow: /promotions-sitemap.xml
`;

  return c.text(robots, 200, {
    'Content-Type': 'text/plain',
    'Cache-Control': 'public, max-age=60',
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

app.get('/items-from-offer/:id', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `items-from-offer:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    console.log(`[CACHE] ${cacheKey} found`);
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/latest-games', async (c) => {
  const start = new Date();
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

  const cacheKey = `latest-games:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
      'X-Cache': 'HIT',
    });
  }

  const items = await Offer.find(
    {
      offerType: { $in: ['BASE_GAME', 'DLC', 'ADDON'] },
    },
    undefined,
    {
      limit: 25,
      sort: {
        creationDate: -1,
      },
    }
  );

  const prices = await PriceEngine.find({
    region,
    offerId: { $in: items.map((i) => i.id) },
  });

  const end = new Date();

  const result = items.map((i) => {
    const price = prices.find((p) => p.offerId === i.id);
    return {
      ...orderOffersObject(i),
      price: price,
    };
  });

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
    'Server-Timing': `db;dur=${end.getTime() - start.getTime()}`,
  });
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
      'Cache-Control': 'public, max-age=60',
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
      'Cache-Control': 'public, max-age=60',
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
  return c.json(countries, 200, {
    'Cache-Control': 'public, max-age=60',
  });
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

  const cacheKey = `sales:${region}:${page}:${limit}:v1.3`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=0',
      'X-Cache': 'HIT',
    });
  }

  const start = new Date();

  const result = await PriceEngine.aggregate<
    { offer: OfferType } & { price: PriceType }
  >([
    {
      $match: {
        region,
        'price.discount': { $gt: 0 },
        'appliedRules.endDate': { $ne: null },
      },
    },
    {
      // Save the data under "price" key
      $addFields: {
        price: '$$ROOT',
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
        'appliedRules.endDate': 1,
      },
    },
    {
      $skip: skip,
    },
    {
      $limit: limit,
    },
  ]);

  const count = await PriceEngine.countDocuments({
    'price.discount': { $gt: 0 },
    region,
  });

  const res = {
    elements: result.map((r) => {
      return {
        ...r.offer,
        price: r.price,
      };
    }),
    page,
    limit,
    total: count,
  };

  await client.set(cacheKey, JSON.stringify(res), {
    EX: 60,
  });

  return c.json(res, 200, {
    'Cache-Control': 'public, max-age=0',
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
    'Cache-Control': 'public, max-age=60',
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

  return c.json(
    {
      region: { code: region, ...regions[region] },
    },
    200,
    {
      'Cache-Control': 'public, max-age=60',
    }
  );
});

app.get('/regions', async (c) => {
  return c.json(regions, 200, {
    'Cache-Control': 'public, max-age=60',
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

app.get('/stats', async (c) => {
  const cacheKey = 'stats:v0.3';

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const [
    offersData,
    itemsData,
    tagsData,
    assetsData,
    priceEngineData,
    changelogData,
    sandboxData,
    productsData,
    offersYearData,
    itemsYearData,
  ] = await Promise.allSettled([
    Offer.countDocuments(),
    Item.countDocuments(),
    Tags.countDocuments(),
    Asset.countDocuments(),
    PriceEngine.countDocuments(),
    Changelog.countDocuments(),
    db.db.collection('sandboxes').countDocuments(),
    db.db.collection('products').countDocuments(),
    Offer.countDocuments({
      creationDate: {
        $gte: new Date(new Date().getFullYear(), 0, 1),
        $lt: new Date(new Date().getFullYear() + 1, 0, 1),
      },
    }),
    Item.countDocuments({
      creationDate: {
        $gte: new Date(new Date().getFullYear(), 0, 1),
        $lt: new Date(new Date().getFullYear() + 1, 0, 1),
      },
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : 0;
  const items = itemsData.status === 'fulfilled' ? itemsData.value : 0;
  const tags = tagsData.status === 'fulfilled' ? tagsData.value : 0;
  const assets = assetsData.status === 'fulfilled' ? assetsData.value : 0;
  const priceEngine =
    priceEngineData.status === 'fulfilled' ? priceEngineData.value : 0;
  const changelog =
    changelogData.status === 'fulfilled' ? changelogData.value : 0;
  const sandboxes = sandboxData.status === 'fulfilled' ? sandboxData.value : 0;
  // @ts-ignore-next-line
  const products = productsData.status === 'fulfilled' ? sandboxData.value : 0;
  const offersYear =
    offersYearData.status === 'fulfilled' ? offersYearData.value : 0;
  const itemsYear =
    itemsYearData.status === 'fulfilled' ? itemsYearData.value : 0;

  const res = {
    offers,
    items,
    tags,
    assets,
    priceEngine,
    changelog,
    sandboxes,
    products,
    offersYear,
    itemsYear,
  };

  await client.set(cacheKey, JSON.stringify(res), {
    EX: 3600,
  });

  return c.json(res, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/tags', async (c) => {
  const group = c.req.query('group');

  const tags = await Tags.find(group ? { groupName: group } : {});

  return c.json(tags);
});

app.post('/ping', async (c) => {
  try {
    const body = await c.req.json();

    if (body?.location?.startsWith('http://localhost:5173') || !body.location) {
      return c.json({ message: 'pong' });
    }

    console.log(`Tracking event from ${body.userId} (${body.event})`);

    const event = new Event({
      event: body.event,
      location: body.location,
      params: body.params,
      userId: body.userId,
      session: body.session.id,
      timestamp: new Date(body.session.lastActiveAt),
    });

    await event.save();

    await gaClient.track(body);

    return c.json({ message: 'pong' });
  } catch (e) {
    console.error(e);
    return c.json({ message: 'error' }, 500);
  }
});

app.get('/ping', async (c) => {
  return c.json({ message: 'pong' });
});

app.options('/ping', async (c) => {
  return c.json({ message: 'pong' });
});

app.patch('/refresh-meilisearch', async (c) => {
  console.log('Refreshing MeiliSearch index');
  const changelogDocs = await Changelog.find({}, undefined, {
    sort: {
      timestamp: -1,
    },
  });

  console.log(`Found ${changelogDocs.length} changelogs`);

  const changelog = changelogDocs.map((c) => c.toObject());

  console.log('Adding documents to MeiliSearch');
  const index = meiliSearchClient.index('changelog');

  await index.addDocuments(changelog, {
    primaryKey: '_id',
  });

  return c.json({ message: 'ok' });
});

app.get('/offer-by-slug/:slug', async (c) => {
  const { slug } = c.req.param();

  const offer = await Offer.findOne({
    'offerMappings.pageSlug': slug,
  });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  return c.json({
    id: offer.id,
  });
});

app.route('/sandboxes', SandboxRoute);

app.route('/search', SearchRoute);

app.route('/offers', OffersRoute);

app.route('/promotions', PromotionsRoute);

app.route('/free-games', FreeGamesRoute);

serve(
  {
    fetch: app.fetch,
    port: 4000,
  },
  (info) => {
    console.log(`Server running at ${info.address}:${info.port}`);
  }
);
