import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { inspectRoutes } from 'hono/dev';
import { getCookie } from 'hono/cookie';
import { etag } from 'hono/etag';
import { logger } from 'hono/logger';
import { createClient } from 'redis';
import { DB } from './db';
import { Offer, type OfferType } from './db/schemas/offer';
import { Item } from './db/schemas/item';
import { orderOffersObject } from './utils/order-offers-object';
import { getFeaturedGames } from './utils/get-featured-games';
import { countries, regions } from './utils/countries';
import { PriceHistory, Sales, type PriceHistoryType } from './db/schemas/price';
import { Tags } from './db/schemas/tags';
import { attributesToObject } from './utils/attributes-to-object';
import { Namespace } from './db/schemas/namespace';
import { AchievementSet } from './db/schemas/achievements';
import mongoose from 'mongoose';
import { getGameFeatures } from './utils/game-features';
import { Asset, AssetType } from './db/schemas/assets';
import { Changelog } from './db/schemas/changelog';

type SalesAggregate = {
  _id: string;
  offerId: string;
  currency: string;
  country: string;
  symbol: string;
  price: TotalPrice;
  __v: number;
  offer: OfferType;
};

interface TotalPrice {
  basePayoutCurrencyCode: string;
  basePayoutPrice: number;
  convenienceFee: number;
  currencyCode: string;
  discount: number;
  discountPrice: number;
  originalPrice: number;
  vat: number;
  voucherDiscount: number;
}

const ALLOWED_ORIGINS = ['https://egdata.app', 'http://localhost:5173'];
const REDISHOST = process.env.REDISHOST || '127.0.0.1';
const REDISPORT = process.env.REDISPORT || '6379';

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
const client = createClient({
  url: `redis://${REDISHOST}:${REDISPORT}`,
  username: process.env.REDISUSER || undefined,
  password: process.env.REDISPASSWORD || undefined,
});

client.connect();
db.connect();

app.use('/*', etag());

app.use(logger());

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

app.get('/offers', async (c) => {
  const start = new Date();
  const MAX_LIMIT = 50;
  const limit = Math.min(
    Number.parseInt(c.req.query('limit') || '10'),
    MAX_LIMIT
  );
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);

  const cacheKey = `offers:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const offers = await Offer.find({}, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      lastModifiedDate: -1,
    },
  }).hint({ lastModifiedDate: 1 });

  const result = {
    elements: offers.map((o) => orderOffersObject(o)),
    page,
    limit,
    total: await Offer.countDocuments(),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get('/offers/events', async (c) => {
  const events = await Tags.find({
    groupName: 'event',
    status: 'ACTIVE',
  });

  return c.json(events, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/offers/events/:id', async (c) => {
  // Same as the /promotions/:id endpoint
  const { id } = c.req.param();
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

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const cacheKey = `event:${id}:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
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

  const offers = await Offer.find(
    {
      tags: { $elemMatch: { id } },
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

  const prices = await PriceHistory.find(
    {
      'metadata.id': { $in: offers.map((o) => o.id) },
      'metadata.region': region,
    },
    undefined,
    {
      sort: {
        date: -1,
      },
    }
  );

  const data = offers.map((o) => {
    const price = prices.find((p) => p.metadata?.id === o.id);
    return {
      id: o.id,
      namespace: o.namespace,
      title: o.title,
      seller: o.seller,
      keyImages: o.keyImages,
      developerDisplayName: o.developerDisplayName,
      publisherDisplayName: o.publisherDisplayName,
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
    EX: 86400,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/offers/:id', async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const start = new Date();

  const cacheKey = `offer:${id}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  // Define the queries
  const offerQuery = Offer.findOne({ id }).lean();

  // Execute both queries in parallel
  const [offer] = await Promise.all([offerQuery]);

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found or Price not found',
    });
  }

  // Combine the offer and price data
  const result = {
    ...offer,
    customAttributes: attributesToObject(offer.customAttributes as any),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    // 1 day
    EX: 86400,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.post('/offers', async (c) => {
  const start = new Date();
  const body = await c.req.json().catch((err) => {
    c.status(400);
    return c.json({ message: 'Invalid request body' });
  });

  const query = body as SearchBody;
  let sort:
    | {
        [key: string]: 1 | -1 | { $meta: 'textScore' };
      }
    | undefined = undefined;

  let search: any = {};
  if (query.query) {
    search.$text = { $search: `"${query.query}"` };
    if (!sort) {
      sort = { score: { $meta: 'textScore' } };
    }
  }

  if (query.namespace) {
    search.namespace = query.namespace;
  }

  if (query.offerType) {
    search.offerType = query.offerType;
  }

  if (query.categories) {
    search.categories = { $in: query.categories };
  }

  if (query.sortBy) {
    if (!sort) sort = {};

    // If the sortBy is "releaseDate", we need to ignore the releases past the current date
    if (query.sortBy === 'releaseDate') {
      search.releaseDate = { $lte: new Date() };
    }

    sort[query.sortBy] = query.sortOrder === 'asc' ? 1 : -1; // Secondary sort by specified field
  }

  const limit = Math.min(query.limit || 10, 100);

  const offers = await Offer.find(search, undefined, {
    limit,
    skip: query.page ? query.page * (query.limit || 10) : 0,
    sort,
  });

  return c.json(
    {
      elements: offers.map((o) => orderOffersObject(o)),
      total: await Offer.countDocuments(search),
      page: query.page || 1,
      limit,
    },
    200,
    {
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    }
  );
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
  }).hint({ lastModifiedDate: 1 });

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

  const cachedResponse = await client.get(responseCacheKey);

  if (cachedResponse) {
    return c.json(JSON.parse(cachedResponse), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const cached = await client.get(cacheKey);

  let featuredGames: { id: string; namespace: string }[] = [];

  if (cached) {
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
      $text: { $search: query.includes('"') ? query : `"${query}"` },
    },
    {
      title: 1,
      id: 1,
      namespace: 1,
      keyImages: 1,
    },
    {
      limit,
      sort: {
        score: { $meta: 'textScore' },
      },
    }
  );

  const response = {
    elements: offers.map((o) => orderOffersObject(o)),
    total: await Offer.countDocuments({
      $text: { $search: `"${query}"` },
    }),
  };

  await client.set(cacheKey, JSON.stringify(response), {
    EX: 60,
  });

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

  const cacheKey = `sales:${region}:${page}:${limit}:v0.2`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': 'HIT',
    });
  }

  const start = new Date();

  const sales = await Sales.find(
    {
      'metadata.region': region,
    },
    undefined,
    {
      limit,
      skip,
      sort: {
        date: -1,
      },
    }
  );

  const count = await Sales.countDocuments({
    'metadata.region': region,
  });

  const offers = await Offer.find(
    {
      // @ts-expect-error
      id: { $in: sales.map((s) => s.metadata.id) },
    },
    {
      id: 1,
      namespace: 1,
      title: 1,
      seller: 1,
      developerDisplayName: 1,
      publisherDisplayName: 1,
      keyImages: 1,
      lastModifiedDate: 1,
      offerType: 1,
    }
  );

  const result = sales.map((s) => {
    // @ts-expect-error
    const offer = offers.find((o) => o.id === s.metadata.id);

    const o = offer?.toObject();

    return {
      id: o?.id,
      namespace: o?.namespace,
      title: o?.title,
      seller: o?.seller,
      developerDisplayName: o?.developerDisplayName,
      publisherDisplayName: o?.publisherDisplayName,
      keyImages: o?.keyImages,
      lastModifiedDate: o?.lastModifiedDate,
      offerType: o?.offerType,
      price: s,
    };
  });

  const res = {
    elements: result,
    page,
    limit,
    total: count,
  };

  await client.set(cacheKey, JSON.stringify(res), {
    EX: 604800,
  });

  return c.json(res, 200, {
    'Cache-Control': 'public, max-age=3600',
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

app.get('/offers/:id/price-history', async (c) => {
  const { id } = c.req.param();

  const country = c.req.query('country');

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(country)
  );

  if (region) {
    const cacheKey = `price-history:${id}:${region}:v0.1`;
    const cached = await client.get(cacheKey);

    if (cached) {
      return c.json(JSON.parse(cached), 200, {
        'Cache-Control': 'public, max-age=3600',
      });
    }

    // Show just the prices for the selected region
    const prices = await PriceHistory.find({
      'metadata.id': id,
      'metadata.region': region,
    }).sort({ date: -1 });

    if (!prices) {
      c.status(200);
      return c.json({});
    }

    await client.set(cacheKey, JSON.stringify(prices), {
      EX: 3600,
    });

    return c.json(prices, 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const cacheKey = `price-history:${id}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const prices = await PriceHistory.find({
    'metadata.id': id,
    // get the prices for all regions
    'metadata.region': { $in: Object.keys(regions) },
  }).sort({ date: -1 });

  // Structure the data, Record<string, PriceHistoryType[]>
  const pricesByRegion = prices.reduce((acc, price) => {
    if (!price.metadata?.region) return acc;

    if (!acc[price.metadata.region]) {
      acc[price.metadata.region] = [];
    }

    acc[price.metadata.region].push(price);

    return acc;
  }, {} as Record<string, PriceHistoryType[]>);

  if (!pricesByRegion || Object.keys(pricesByRegion).length === 0) {
    c.status(200);
    return c.json({});
  }

  await client.set(cacheKey, JSON.stringify(pricesByRegion), {
    EX: 3600,
  });

  return c.json(pricesByRegion, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/offers/:id/features', async (c) => {
  const { id } = c.req.param();

  // We need to get the offers and items for that offer
  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const items = await Item.find({
    linkedOffers: { $in: [id] },
  });

  const customAttributes = items.reduce((acc, item) => {
    return {
      ...acc,
      ...attributesToObject(item.customAttributes as any),
    };
  }, attributesToObject([]));

  // Get the game features
  const gameFeatures = getGameFeatures({
    attributes: customAttributes,
    tags: offer.tags.reduce((acc, tag) => {
      return {
        ...acc,
        [tag.id]: tag,
      };
    }, {}),
  });

  return c.json(gameFeatures);
});

app.get('/offers/:id/assets', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `assets:offer:${id}:v0.2`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const assets = await Item.aggregate<{ assets: AssetType[] }>([
    {
      $match: {
        linkedOffers: id,
      },
    },
    {
      $lookup: {
        from: 'assets',
        localField: 'id',
        foreignField: 'itemId',
        as: 'assets',
      },
    },
    {
      $unwind: '$assets',
    },
    {
      $project: {
        _id: 0,
        assets: 1,
      },
    },
  ]);

  const result = assets.flatMap((a) => a.assets);

  await client.set(cacheKey, JSON.stringify(assets), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/offers/:id/items', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `items:offer:${id}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const items = await Item.find({
    linkedOffers: id,
  });

  await client.set(cacheKey, JSON.stringify(items), {
    EX: 3600,
  });

  return c.json(items, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/offers/:id/price', async (c) => {
  const { id } = c.req.param();
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

  const cacheKey = `price:${id}:${region}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const price = await PriceHistory.findOne(
    {
      'metadata.id': id,
      'metadata.region': region,
    },
    undefined,
    {
      sort: {
        date: -1,
      },
    }
  );

  if (!price) {
    c.status(404);
    return c.json({
      message: 'Price not found',
    });
  }

  await client.set(cacheKey, JSON.stringify(price), {
    EX: 3600,
  });

  return c.json(price, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/offers/:id/regional-price', async (c) => {
  const { id } = c.req.param();
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

  // Iterate over all the regions (faster than aggregating) to get the last price, max and min for each region
  const prices = await PriceHistory.find(
    {
      'metadata.id': id,
    },
    undefined,
    {
      sort: {
        date: -1,
      },
    }
  );

  const regionsKeys = Object.keys(regions);

  const result = regionsKeys.reduce(
    (acc, r) => {
      const regionPrices = prices.filter((p) => p.metadata?.region === r);

      if (!regionPrices.length) {
        return acc;
      }

      const lastPrice = regionPrices[0];

      const allPrices = regionPrices.map(
        (p) => p.totalPrice.discountPrice ?? 0
      );

      const maxPrice = Math.max(...allPrices);

      const minPrice = Math.min(...allPrices);

      acc[r] = {
        currentPrice: lastPrice,
        maxPrice,
        minPrice,
      };

      return acc;
    },
    {} as Record<
      string,
      {
        currentPrice: PriceHistoryType;
        maxPrice: number;
        minPrice: number;
      }
    >
  );

  return c.json(result);
});

app.get('/offers/:id/changelog', async (c) => {
  const { id } = c.req.param();

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const cacheKey = `changelog:${id}:${page}:${limit}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const changelist = await Changelog.find(
    {
      'metadata.contextId': id,
    },
    undefined,
    {
      sort: {
        timestamp: -1,
      },
      limit,
      skip,
    }
  );

  if (!changelist) {
    c.status(404);
    return c.json({
      message: 'Changelist not found',
    });
  }

  await client.set(cacheKey, JSON.stringify(changelist), {
    EX: 3600,
  });

  return c.json(changelist);
});

app.get('/offers/:id/achievements', async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const offer = await Offer.findOne(
    { id },
    {
      namespace: 1,
      offerType: 1,
    }
  );

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const cacheKey = `achievements:offer:${id}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const achievements = await AchievementSet.find({
    sandboxId: offer.namespace,
    isBase: offer.offerType === 'BASE_GAME',
  });

  await client.set(cacheKey, JSON.stringify(achievements), {
    EX: 604800,
  });

  return c.json(achievements);
});

app.get('/offers/:id/related', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `related-offers:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const offer = await Offer.findOne({ id }, { namespace: 1, id: 1 });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const related = await Offer.find(
    {
      namespace: offer.namespace,
      id: { $ne: offer.id },
    },
    {
      _id: 0,
      id: 1,
      namespace: 1,
      title: 1,
      keyImages: 1,
      lastModifiedDate: 1,
      creationDate: 1,
      viewableDate: 1,
      effectiveDate: 1,
      offerType: 1,
    }
  );

  await client.set(cacheKey, JSON.stringify(related), {
    EX: 3600,
  });

  return c.json(related, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
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

  const cacheKey = `promotion:${id}:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
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

  const prices = await PriceHistory.find(
    {
      'metadata.id': { $in: offers.map((o) => o.id) },
      'metadata.region': region,
    },
    undefined,
    {
      sort: {
        date: -1,
      },
    }
  );

  const data = offers.map((o) => {
    const price = prices.find((p) => p.metadata?.id === o.id);
    return {
      id: o.id,
      namespace: o.namespace,
      title: o.title,
      seller: o.seller,
      keyImages: o.keyImages,
      developerDisplayName: o.developerDisplayName,
      publisherDisplayName: o.publisherDisplayName,
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
    EX: 86400,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    'Cache-Control': 'public, max-age=3600',
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
    EX: 86400,
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

app.get('/sandboxes/:sandboxId/achievements', async (ctx) => {
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

interface SearchBody {
  limit?: number;
  page?: number;
  query?: string;
  namespace?: string;
  offerType?: string;
  sortBy?:
    | 'lastModifiedDate'
    | 'creationDate'
    | 'effectiveDate'
    | 'releaseDate'
    | 'pcReleaseDate'
    | 'currentPrice';
  sortOrder?: 'asc' | 'desc';
  categories?: string[];
}

export default {
  port: 4000,
  fetch: app.fetch,
};
