import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { createClient } from 'redis';
import { DB } from './db';
import { Offer, OfferType } from './db/schemas/offer';
import { Item } from './db/schemas/item';
import { orderOffersObject } from './utils/order-offers-object';
import { getFeaturedGames } from './utils/get-featured-games';
import { countries, regions } from './utils/countries';
import { PriceHistory, PriceHistoryType } from './db/schemas/price';
import { Tags } from './db/schemas/tags';
import { attributesToObject } from './utils/attributes-to-object';

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
});

client.connect();
db.connect();

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
  });
});

app.get('/', (c) => {
  return c.json({
    app: 'egdata',
    version: '0.0.1-alpha',
    endpoints: [
      '/offers',
      '/offers/:id',
      '/items',
      '/items/:id',
      '/latest-games',
      '/featured',
      '/autocomplete',
      '/countries',
    ],
  });
});

app.get('/sitemap', async (c) => {
  const pageSize = 1000;
  let siteMap = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

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

    if (offers.length === 0) {
      hasMore = false;
    } else {
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

  return c.text(siteMap, 200, {
    'Content-Type': 'application/xml',
    'Cache-Control': 'public, max-age=3600',
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

  const offers = await Offer.find({}, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      lastModifiedDate: -1,
    },
  })
    .hint({ lastModifiedDate: 1 })
    .allowDiskUse(true);

  return c.json(
    {
      elements: offers.map((o) => orderOffersObject(o)),
      page,
      limit,
      total: await Offer.countDocuments(),
    },
    200,
    {
      'Cache-Control': 'public, max-age=60',
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    }
  );
});

app.get('/offers/:id', async (c) => {
  const { id } = c.req.param();
  const country = c.req.query('country');

  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const start = new Date();

  const selectedCountry = country ?? cookieCountry ?? 'US';
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  // Define the queries
  const offerQuery = Offer.findOne({ id }).lean();
  const pricesQuery = PriceHistory.findOne(
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
  ).lean();

  // Execute both queries in parallel
  const [offer, price] = await Promise.all([offerQuery, pricesQuery]);

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
    price: price || null,
  };

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

  return c.json(
    resultItems.map((i) => {
      return {
        ...i,
        customAttributes: attributesToObject(i.customAttributes as any),
      };
    })
  );
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
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  const cacheKey = `featured:${region}`;

  const cached = await client.get(cacheKey);

  let featuredGames: { id: string; namespace: string }[] = [];

  if (cached) {
    featuredGames = JSON.parse(cached);
  } else {
    featuredGames = await getFeaturedGames();
    await client.set(cacheKey, JSON.stringify(featuredGames), {
      EX: 3600,
    });
  }

  const GET_FEATURED_GAMES_END = new Date();

  let game = null;

  const start = new Date();
  // Try to find a game from the featured games list
  for (let i = 0; i < featuredGames.length; i++) {
    const randomGame =
      featuredGames[Math.floor(Math.random() * featuredGames.length)];

    game = await Offer.findOne({
      id: randomGame.id,
      namespace: randomGame.namespace,
    });

    if (game) {
      break;
    }
  }

  if (!game) {
    c.status(404);
    return c.json({
      message: 'No games found in the featured list',
    });
  }

  const price = await PriceHistory.findOne(
    {
      'metadata.id': game.id,
      'metadata.region': 'US',
    },
    undefined,
    {
      sort: {
        date: -1,
      },
    }
  );

  return c.json({ ...orderOffersObject(game), price }, 200, {
    'Cache-Control': 'public, max-age=3600',
    'Server-Timing': `db;dur=${
      new Date().getTime() - start.getTime()
    }, egsAPI;dur=${
      GET_FEATURED_GAMES_END.getTime() - GET_FEATURED_GAMES_START.getTime()
    }`,
  });
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

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const skip = (page - 1) * limit;

  const start = new Date();

  const [sales, totalCount] = await Promise.all([
    db.db
      .collection('PriceHistory')
      .aggregate<SalesAggregate>([
        {
          $match: {
            'metadata.region': region,
          },
        },
        {
          $sort: {
            date: -1,
          },
        },
        {
          $group: {
            _id: '$metadata.id',
            date: { $first: '$date' },
            lastPrice: { $first: '$totalPrice' },
            lastPaymentPrice: {
              $first: '$totalPaymentPrice',
            },
          },
        },
        {
          $match: {
            'lastPrice.discount': { $gt: 0 },
          },
        },
        { $skip: skip },
        { $limit: limit },
      ])
      .toArray(),
    db.db.collection('PriceHistory').countDocuments({
      country: regions[region].countries[0],
      'totalPrice.discount': { $gt: 0 },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  const offersWithPrices = await Offer.find({
    id: { $in: sales.map((s) => s._id) },
  });

  return c.json(
    {
      elements: offersWithPrices.map((o) => {
        const sale = sales.find((s) => s._id === o.id);
        return {
          ...orderOffersObject(o),
          price: sale,
        };
      }),
      page,
      limit,
      total: totalCount,
      totalPages,
    },
    200,
    {
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    }
  );
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
    // Show just the prices for the selected region
    const prices = await PriceHistory.find({
      'metadata.id': id,
      'metadata.region': region,
    }).sort({ date: -1 });

    return c.json(prices);
  }

  const cacheKey = `price-history:${id}`;
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

  await client.set(cacheKey, JSON.stringify(pricesByRegion), {
    EX: 86400,
  });

  return c.json(pricesByRegion, 200, {
    'Cache-Control': 'public, max-age=86400',
  });
});

app.get('/price/:id', async (c) => {
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

  return c.json(price);
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
      limit: 20,
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

  return c.json(
    offers.map((o) => {
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
    }),
    200,
    {
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
      'Cache-Control': 'public, max-age=3600',
    }
  );
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
    region: regions[region],
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
