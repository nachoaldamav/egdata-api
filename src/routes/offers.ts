import { Hono } from 'hono';
import { regions } from '../utils/countries';
import client from '../clients/redis';
import { PriceEngineHistorical, PriceType } from '../db/schemas/price-engine';
import { getCookie } from 'hono/cookie';
import { AchievementSet } from '../db/schemas/achievements';
import { AssetType } from '../db/schemas/assets';
import { Changelog } from '../db/schemas/changelog';
import { Item } from '../db/schemas/item';
import { Mappings } from '../db/schemas/mappings';
import { Offer } from '../db/schemas/offer';
import { attributesToObject } from '../utils/attributes-to-object';
import { getGameFeatures } from '../utils/game-features';
import { Tags } from '../db/schemas/tags';
import { orderOffersObject } from '../utils/order-offers-object';

const app = new Hono();

app.get('/', async (c) => {
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
  });

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

app.get('/events', async (c) => {
  const events = await Tags.find({
    groupName: 'event',
    status: 'ACTIVE',
  });

  return c.json(events, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/events/:id', async (c) => {
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

  const offers = await Offer.aggregate([
    { $match: { tags: { $elemMatch: { id } } } },
    {
      $lookup: {
        from: 'pricev2',
        let: { offerId: '$id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$offerId', '$$offerId'] },
                  { $eq: ['$region', region] },
                ],
              },
            },
          },
          {
            $sort: { updatedAt: -1 },
          },
          {
            $limit: 1,
          },
        ],
        as: 'price',
      },
    },
    {
      $unwind: {
        path: '$price',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: { 'price.price.discount': -1 },
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
        id: 1,
        namespace: 1,
        title: 1,
        seller: 1,
        developerDisplayName: 1,
        publisherDisplayName: 1,
        keyImages: 1,
        price: 1,
      },
    },
  ]);

  const result = {
    elements: offers,
    title: event.name ?? '',
    limit,
    start: skip,
    page,
    count: await Offer.countDocuments({
      tags: { $elemMatch: { id } },
    }),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/upcoming', async (c) => {
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

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '15'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const cacheKey = `upcoming:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const offers = await Offer.aggregate([
    {
      $match: {
        releaseDate: {
          $gt: new Date(),
          $ne: null,
          $lt: new Date('2099-01-01'),
        },
        // Only show "BASE_GAME" and "DLC" offers
        offerType: {
          $in: ['BASE_GAME', 'DLC'],
        },
      },
    },
    {
      $lookup: {
        from: 'pricev2',
        let: { offerId: '$id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$offerId', '$$offerId'] },
                  { $eq: ['$region', region] },
                ],
              },
            },
          },
          {
            $limit: 1,
          },
        ],
        as: 'price',
      },
    },
    {
      $unwind: {
        path: '$price',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: { releaseDate: 1 },
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
        id: 1,
        namespace: 1,
        title: 1,
        seller: 1,
        developerDisplayName: 1,
        publisherDisplayName: 1,
        keyImages: 1,
        releaseDate: 1,
        price: 1,
      },
    },
  ]);

  const result = {
    elements: offers,
    limit,
    start: skip,
    page,
    count: await Offer.countDocuments({
      effectiveDate: { $gt: new Date() },
    }),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 360,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id', async (c) => {
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

app.get('/:id/price-history', async (c) => {
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
    const prices = await PriceEngineHistorical.find({
      offerId: id,
      region,
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

  const prices = await PriceEngineHistorical.find({
    offerId: id,
    region: { $in: Object.keys(regions) },
  }).sort({ date: -1 });

  // Structure the data, Record<string, PriceHistoryType[]>
  const pricesByRegion = prices.reduce((acc, price) => {
    if (!price?.region) return acc;

    if (!acc[price.region]) {
      acc[price.region] = [];
    }

    acc[price.region].push(price);

    return acc;
  }, {} as Record<string, PriceType[]>);

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

app.get('/:id/features', async (c) => {
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

app.get('/:id/assets', async (c) => {
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

app.get('/:id/items', async (c) => {
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

app.get('/:id/price', async (c) => {
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

  const price = await PriceEngineHistorical.findOne(
    {
      offerId: id,
      region,
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

app.get('/:id/regional-price', async (c) => {
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
  const prices = await PriceEngineHistorical.find(
    {
      offerId: id,
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
      const regionPrices = prices.filter((p) => p?.region === r);

      if (!regionPrices.length) {
        return acc;
      }

      const lastPrice = regionPrices[0];

      const allPrices = regionPrices.map((p) => p.price.discountPrice ?? 0);

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
        currentPrice: PriceType;
        maxPrice: number;
        minPrice: number;
      }
    >
  );

  return c.json(result);
});

app.get('/:id/changelog', async (c) => {
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

app.get('/:id/achievements', async (c) => {
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

  const cacheKey = `achievements:offer:${id}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const achievements = await AchievementSet.find({
    sandboxId: offer.namespace,
    isBase: offer.offerType === 'BASE_GAME',
  });

  if (achievements.length === 0) {
    c.status(200);
    return c.json([]);
  }

  await client.set(cacheKey, JSON.stringify(achievements), {
    EX: 3600,
  });

  return c.json(achievements, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/related', async (c) => {
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

app.get('/:id/mappings', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `mappings:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const mappings = await Mappings.findOne({
    _id: id,
  });

  if (!mappings) {
    c.status(404);
    return c.json({
      message: 'Mappings not found',
    });
  }

  await client.set(cacheKey, JSON.stringify(mappings), {
    // 1 day
    EX: 86400,
  });

  return c.json(mappings, 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

export default app;
