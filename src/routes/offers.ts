import { Hono } from 'hono';
import { regions } from '../utils/countries.js';
import client from '../clients/redis.js';
import {
  PriceEngine,
  PriceEngineHistorical,
  PriceType,
} from '../db/schemas/price-engine.js';
import { getCookie } from 'hono/cookie';
import { AchievementSet } from '../db/schemas/achievements.js';
import { Asset, AssetType } from '../db/schemas/assets.js';
import { Changelog } from '../db/schemas/changelog.js';
import { Item } from '../db/schemas/item.js';
import { Mappings } from '../db/schemas/mappings.js';
import { Offer, OfferType } from '../db/schemas/offer.js';
import { attributesToObject } from '../utils/attributes-to-object.js';
import { getGameFeatures } from '../utils/game-features.js';
import { TagModel, Tags } from '../db/schemas/tags.js';
import { orderOffersObject } from '../utils/order-offers-object.js';
import { getImage } from '../utils/get-image.js';
import { Media } from '../db/schemas/media.js';
import { CollectionOffer } from '../db/schemas/collections.js';
import { Sandbox } from '../db/schemas/sandboxes.js';
import { FreeGames } from '../db/schemas/freegames.js';
import { db } from '../db/index.js';
import { Ratings } from '@egdata/core.schemas.ratings';
import { IReview, Review } from '../db/schemas/reviews.js';
import { getDiscordUser } from '../utils/get-discord-user.js';
import { getProduct } from '../utils/get-product.js';
import { verifyGameOwnership } from '../utils/verify-game-ownership.js';
import { User } from '../db/schemas/users.js';

const app = new Hono();

app.get('/', async (c) => {
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

  const MAX_LIMIT = 50;
  const limit = Math.min(
    Number.parseInt(c.req.query('limit') || '10'),
    MAX_LIMIT
  );
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);

  const cacheKey = `offers:${region}:${page}:${limit}`;

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

  const prices = await PriceEngine.find({
    offerId: { $in: offers.map((o) => o.id) },
    region,
  });

  const result = {
    elements: offers.map((o) => {
      const price = prices.find((p) => p.offerId === o.id);
      return {
        ...orderOffersObject(o),
        price: price ?? null,
      };
    }),
    page,
    limit,
    total: await Offer.countDocuments(),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
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
    'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=60',
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

  const cacheKey = `upcoming:${region}:${page}:${limit}:v0.1`;

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
  ]);

  const result = {
    elements: offers.map((o) => {
      return {
        ...orderOffersObject(o),
        price: o.price ?? null,
      };
    }),
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

app.get('/genres', async (c) => {
  const genres = await Tags.find({
    groupName: 'genre',
    status: 'ACTIVE',
  });

  const result = await Promise.all(
    genres.map(async (genre) => {
      const offers = await Offer.find(
        {
          tags: { $elemMatch: { id: genre.id } },
          offerType: 'BASE_GAME',
          releaseDate: { $lte: new Date() },
        },
        undefined,
        {
          limit: 3,
          sort: {
            releaseDate: -1,
          },
        }
      );

      return {
        genre,
        offers: offers.map((o) => {
          return {
            id: o.id,
            title: o.title,
            image: getImage(o.keyImages, [
              'OfferImageTall',
              'Thumbnail',
              'DieselGameBoxTall',
              'DieselStoreFrontTall',
            ]),
          };
        }),
      };
    })
  );

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/top-wishlisted', async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 1);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const cacheKey = `top-wishlisted:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const result = await CollectionOffer.aggregate([
    {
      $match: {
        _id: 'top-wishlisted',
      },
    },
    {
      $project: {
        offers: {
          $slice: ['$offers', skip, limit],
        },
      },
    },
    {
      $lookup: {
        from: 'offers',
        localField: 'offers._id',
        foreignField: 'id',
        as: 'offerDetails',
      },
    },
    {
      $unwind: '$offerDetails',
    },
    {
      $sort: {
        'offerDetails.id': -1,
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $first: {
            $size: '$offers',
          },
        },
        elements: {
          $push: '$offerDetails',
        },
      },
    },
    {
      $project: {
        _id: 0,
        page: {
          $literal: 1,
        },
        limit: {
          $literal: 1,
        },
        total: 1,
        elements: 1,
      },
    },
  ]);

  if (result.length > 0) {
    const response = {
      elements: result[0].elements.map((o: OfferType) => orderOffersObject(o)),
      page,
      limit,
      total:
        (
          await CollectionOffer.findOne({
            _id: 'top-wishlisted',
          }).exec()
        )?.offers.length ?? 0,
    };

    await client.set(cacheKey, JSON.stringify(response), {
      EX: 3600,
    });

    return c.json(response, 200, {
      'Cache-Control': 'public, max-age=60',
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    });
  }

  return c.json({ elements: [], page, limit, total: 0 }, 200, {
    'Cache-Control': 'public, max-age=60',
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get('/top-sellers', async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const cacheKey = `top-sellers:${page}:${limit}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const result = await CollectionOffer.aggregate([
    {
      $match: {
        _id: 'top-sellers',
      },
    },
    {
      $unwind: '$offers',
    },
    {
      $sort: {
        'offers.position': 1, // Sort by position in ascending order
      },
    },
    {
      $group: {
        _id: '$_id',
        offers: { $push: '$offers' },
      },
    },
    {
      $project: {
        offers: { $slice: ['$offers', skip, limit] },
      },
    },
    {
      $unwind: '$offers',
    },
    {
      $lookup: {
        from: 'offers',
        localField: 'offers._id',
        foreignField: 'id',
        as: 'offerDetails',
      },
    },
    {
      $unwind: '$offerDetails',
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        elements: { $push: '$offerDetails' },
      },
    },
    {
      $project: {
        _id: 0,
        page: { $literal: page },
        limit: { $literal: limit },
        total: 1,
        elements: 1,
      },
    },
  ]);

  if (result.length > 0) {
    const response = {
      elements: result[0].elements.map((o: OfferType) => orderOffersObject(o)),
      page,
      limit,
      total:
        (
          await CollectionOffer.findOne({
            _id: 'top-sellers',
          }).exec()
        )?.offers.length ?? 0,
    };

    await client.set(cacheKey, JSON.stringify(response), {
      EX: 360,
    });

    return c.json(response, 200, {
      'Cache-Control': 'public, max-age=60',
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    });
  }
});

app.get('/featured-discounts', async (c) => {
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

  const cacheKey = `featured-discounts:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const featuredOffers = await CollectionOffer.find({}, 'offers._id').lean();
  const offersIds = featuredOffers.flatMap((o) => o.offers.map((o) => o._id));

  const offers = await Offer.find({
    id: { $in: offersIds },
    // Only show "BASE_GAME" and "DLC" offers
    offerType: {
      $in: ['BASE_GAME', 'DLC'],
    },
  });

  const prices = await PriceEngine.find({
    offerId: { $in: offers.map((o) => o.id) },
    region,
    'price.discount': { $gt: 0 },
  });

  const result = offers
    .map((o) => {
      const price = prices.find((p) => p.offerId === o.id);

      return {
        ...o.toObject(),
        price: price ?? null,
      };
    })
    .filter((o) => o.price)
    .slice(0, 20);

  // Save the result in cache, set the expiration to the first sale ending date
  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/latest-achievements', async (c) => {
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

  const cacheKey = `latest-achievements:${region}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const limit = 15; // Number of games to fetch per page
  let skip = 0;
  let result: any[] = [];

  while (result.length < 20) {
    const offers = await Offer.find({
      offerType: { $in: ['BASE_GAME'] },
      'tags.id': '19847',
      effectiveDate: { $lte: new Date() },
    })
      .sort({ effectiveDate: -1 })
      .skip(skip)
      .limit(limit);

    const [achievementsData, pricesData] = await Promise.allSettled([
      AchievementSet.find({
        sandboxId: { $in: offers.map((o) => o.namespace) },
        isBase: true,
      }),
      PriceEngine.find({
        offerId: { $in: offers.map((o) => o.id) },
        region,
      }),
    ]);

    const achievements =
      achievementsData.status === 'fulfilled' ? achievementsData.value : [];
    const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

    const pageResults = offers
      .map((o) => {
        const price = prices.find((p) => p.offerId === o.id);
        const achievement = achievements.find(
          (a) => a.sandboxId === o.namespace
        );
        return {
          ...orderOffersObject(o),
          achievements: achievement,
          price: price ?? null,
        };
      })
      .filter((o) => o.achievements);

    result = result.concat(pageResults);
    skip += limit;

    if (offers.length < limit) {
      // Reached the end of the data
      break;
    }
  }

  result = result.slice(0, 20);

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
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
      'Cache-Control': 'public, max-age=60',
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
  const since = c.req.query('since');

  const country = c.req.query('country');
  const usrRegion = c.req.query('region');

  const region =
    usrRegion ||
    Object.keys(regions).find((r) => regions[r].countries.includes(country));

  if (region) {
    const cacheKey = `price-history:${id}:${region}:${
      since ?? 'unlimited'
    }:v0.1`;
    const cached = await client.get(cacheKey);

    if (cached) {
      return c.json(JSON.parse(cached), 200, {
        'Cache-Control': 'public, max-age=60',
      });
    }

    // Show just the prices for the selected region
    const prices = await PriceEngineHistorical.find({
      offerId: id,
      region,
      ...(since && {
        updatedAt: { $gte: new Date(since) },
      }),
    }).sort({ date: -1 });

    if (!prices) {
      c.status(200);
      return c.json({});
    }

    await client.set(cacheKey, JSON.stringify(prices), {
      EX: 3600,
    });

    return c.json(prices, 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const cacheKey = `price-history:${id}:all:${since ?? 'unlimited'}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const prices = await PriceEngineHistorical.find({
    offerId: id,
    region: { $in: Object.keys(regions) },
    ...(since && {
      updatedAt: { $gte: new Date(since) },
    }),
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
    'Cache-Control': 'public, max-age=60',
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
      'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/items', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `items:offer:${id}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const items = await Item.find({
    linkedOffers: id,
  });

  await client.set(cacheKey, JSON.stringify(items), {
    EX: 3600,
  });

  return c.json(items, 200, {
    'Cache-Control': 'public, max-age=60',
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

  const cacheKey = `price:${id}:${region}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const price = await PriceEngine.findOne({
    offerId: id,
    region,
  });

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
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/regional-price', async (c) => {
  const { id } = c.req.param();
  const country = c.req.query('country');

  if (country) {
    const region = Object.keys(regions).find((r) =>
      regions[r].countries.includes(country)
    );

    if (!region) {
      c.status(404);
      return c.json({
        message: 'Country not found',
      });
    }

    const cacheKey = `regional-price:${id}:${region}:v0.1`;
    const cached = await client.get(cacheKey);

    if (cached) {
      return c.json(JSON.parse(cached), 200, {
        'Cache-Control': 'public, max-age=60',
      });
    }

    const price = await PriceEngineHistorical.find(
      {
        offerId: id,
        region,
      },
      undefined,
      {
        sort: {
          updatedAt: -1,
        },
      }
    );

    if (!price) {
      c.status(404);
      return c.json({
        message: 'Price not found',
      });
    }

    const result = {
      currentPrice: price[0],
      maxPrice: Math.max(...price.map((p) => p.price.discountPrice ?? 0)),
      minPrice: Math.min(...price.map((p) => p.price.discountPrice ?? 0)),
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 3600,
    });

    return c.json(result, 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const cacheKey = `regional-price:${id}:all:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
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
        updatedAt: -1,
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

      const lastPrice = regionPrices.sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      )[0];

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

  const cacheKey = `changelog:${id}:${page}:${limit}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const [offerData, itemsData] = await Promise.allSettled([
    Offer.findOne({ id }),
    Item.find({
      linkedOffers: id,
    }),
  ]);

  const offer = offerData.status === 'fulfilled' ? offerData.value : null;
  const items = itemsData.status === 'fulfilled' ? itemsData.value : [];

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const itemsIds = items.map((i) => i.id);
  const assets = await Asset.find({
    itemId: { $in: itemsIds },
  });

  const allIds = [id, ...itemsIds.concat(assets.map((a) => a.artifactId))];

  const changelist = await Changelog.find(
    {
      'metadata.contextId': { $in: allIds },
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
      'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/mappings', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `mappings:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/media', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `media:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const media = await Media.findOne({
    _id: id,
  });

  if (!media) {
    c.status(404);
    return c.json({
      message: 'Media not found',
    });
  }

  await client.set(cacheKey, JSON.stringify(media), {
    // 1 day
    EX: 86400,
  });

  return c.json(media, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/suggestions', async (c) => {
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

  const cacheKey = `suggestions:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const tagsIds = offer.tags.map((t) => t.id);
  const tagsInformation = await TagModel.find({
    id: { $in: tagsIds },
  });

  const genres = tagsInformation.filter((t) => t.groupName === 'genre');

  const suggestions = await Offer.find(
    {
      tags: { $elemMatch: { id: { $in: genres.map((g) => g.id) } } },
      id: { $ne: id },
      namespace: { $ne: offer.namespace },
      offerType: { $in: ['BASE_GAME', 'DLC'] },
    },
    undefined,
    {
      limit: 25,
      sort: {
        lastModifiedDate: -1,
      },
    }
  );

  const prices = await PriceEngine.find({
    offerId: { $in: suggestions.map((o) => o.id) },
    region: region,
  });

  const result = suggestions.map((o) => {
    const price = prices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price: price ?? null,
    };
  });

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/age-rating', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `age-rating:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const sandbox = await Sandbox.findOne({
    _id: offer.namespace,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: 'Sandbox not found',
    });
  }

  const ageRatings = sandbox.ageGatings;

  await client.set(cacheKey, JSON.stringify(ageRatings), {
    EX: 3600,
  });

  return c.json(ageRatings, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/giveaways', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `giveaways:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const giveaways = await FreeGames.find(
    {
      id,
    },
    undefined,
    {
      sort: {
        startDate: -1,
      },
    }
  );

  await client.set(cacheKey, JSON.stringify(giveaways), {
    EX: 3600,
  });

  return c.json(giveaways, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/ratings', async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  const cacheKey = `ratings:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const sandbox = await Sandbox.findOne({
    _id: offer.namespace,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: 'Sandbox not found',
    });
  }

  const product = await db.db.collection('products').findOne({
    // @ts-expect-error - _id in products is a string
    _id: sandbox.parent,
  });

  if (!product) {
    c.status(404);
    return c.json({
      message: 'Product not found',
    });
  }

  const ratings = await Ratings.findOne({
    _id: product.slug,
  });

  if (!ratings) {
    c.status(404);
    return c.json({
      message: 'Ratings not found',
    });
  }

  await client.set(cacheKey, JSON.stringify(ratings), {
    EX: 3600,
  });

  return c.json(ratings, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/tops', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `tops:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const [topWishlisted, topSellers] = await Promise.all([
    CollectionOffer.findOne({
      _id: 'top-wishlisted',
      'offers._id': id,
    }),
    CollectionOffer.findOne({
      _id: 'top-sellers',
      'offers._id': id,
    }),
  ]);

  const whishlistedPosition =
    topWishlisted?.offers.find((o) => o._id === id)?.position ?? 0;
  const sellersPosition =
    topSellers?.offers.find((o) => o._id === id)?.position ?? 0;

  const result = {
    topWishlisted: whishlistedPosition === 0 ? undefined : whishlistedPosition,
    topSellers: sellersPosition === 0 ? undefined : sellersPosition,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/reviews', async (c) => {
  const { id } = c.req.param();
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 25);
  const skip = (page - 1) * limit;
  const onlyVerified = c.req.query('verified') === 'true';

  const cacheKey = `reviews:${id}:${page}:${limit}:${
    onlyVerified ? 'verified' : 'all'
  }`;

  // const cached = await client.get(cacheKey);

  // if (cached) {
  //   return c.json(JSON.parse(cached), 200, {
  //     'Cache-Control': 'public, max-age=60',
  //   });
  // }

  const reviews = await Review.find(
    {
      id: id,
      ...(onlyVerified && {
        verified: true,
      }),
    },
    undefined,
    {
      sort: {
        createdAt: -1,
      },
      limit,
      skip,
    }
  );

  if (!reviews) {
    c.status(200);
    return c.json({
      elements: [],
      page: 1,
      total: 0,
      limit,
    });
  }

  const result = {
    elements: reviews,
    page,
    total: await Review.countDocuments({
      id,
      ...(onlyVerified && {
        verified: true,
      }),
    }),
    limit,
  };

  if (reviews.length > 0) {
    await client.set(cacheKey, JSON.stringify(result), {
      EX: 3600,
    });
  }

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.post('/:id/reviews', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<
    Omit<IReview, 'id' | 'createdAt' | 'verified' | 'userId'>
  >();
  const Authorization = c.req.header('Authorization');

  if (!Authorization) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  if (!body || !body.rating || !body.title || !body.content) {
    c.status(400);
    return c.json({
      message: 'Missing required fields',
    });
  }

  const token = Authorization.replace('Bearer ', '');

  const user = await getDiscordUser(token);

  if (!user) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  const dbUser = await User.findOne({
    id: user.id,
  });

  if (!dbUser) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  // Check if the user already reviewed the product
  const existingReview = await Review.findOne({
    userId: dbUser.id,
    id,
  });

  if (existingReview) {
    c.status(400);
    return c.json({
      message: 'User already reviewed this product',
    });
  }

  const product = await getProduct(id);

  if (!product) {
    c.status(404);
    return c.json({
      message: 'Product not found',
    });
  }

  const isOwned = dbUser?.epicId
    ? await verifyGameOwnership(
        dbUser?.epicId,
        product._id as unknown as string
      )
    : false;

  const review: IReview = {
    id,
    rating: body.rating,
    title: body.title,
    content: body.content,
    tags: body.tags.slice(0, 5),
    verified: isOwned,
    userId: dbUser.id,
    createdAt: new Date(),
  };

  await Review.create(review);

  return c.json(
    {
      status: 'ok',
    },
    201
  );
});

app.patch('/:id/reviews', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<Omit<IReview, 'id' | 'createdAt' | 'userId'>>();
  const Authorization = c.req.header('Authorization');

  if (!Authorization) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  if (!body || !body.rating || !body.title || !body.content) {
    c.status(400);
    return c.json({
      message: 'Missing required fields',
    });
  }

  const token = Authorization.replace('Bearer ', '');

  const user = await getDiscordUser(token);

  if (!user) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  const dbUser = await User.findOne({
    id: user.id,
  });

  if (!dbUser) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  const product = await getProduct(id);

  if (!product) {
    c.status(404);
    return c.json({
      message: 'Product not found',
    });
  }

  const isOwned = dbUser?.epicId
    ? await verifyGameOwnership(
        dbUser?.epicId,
        product._id as unknown as string
      )
    : false;

  const review: IReview = {
    id,
    rating: body.rating,
    title: body.title,
    content: body.content,
    tags: body.tags.slice(0, 5),
    verified: isOwned,
    userId: dbUser.id,
    createdAt: new Date(),
  };

  await Review.findOneAndUpdate(
    {
      userId: dbUser.id,
      id,
    },
    review
  );

  return c.json(
    {
      status: 'ok',
    },
    200
  );
});

app.delete('/:id/reviews', async (c) => {
  const { id } = c.req.param();
  const Authorization = c.req.header('Authorization');

  if (!Authorization) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  const token = Authorization.replace('Bearer ', '');

  const user = await getDiscordUser(token);

  if (!user) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  const dbUser = await User.findOne({
    id: user.id,
  });

  if (!dbUser) {
    c.status(401);
    return c.json({
      message: 'Unauthorized',
    });
  }

  const review = await Review.findOne({
    userId: dbUser.id,
    id,
  });

  if (!review) {
    c.status(404);
    return c.json({
      message: 'Review not found',
    });
  }

  await Review.deleteOne({
    userId: dbUser.id,
  });

  return c.json(
    {
      status: 'ok',
    },
    200
  );
});

app.get('/:id/reviews-summary', async (c) => {
  const { id } = c.req.param();
  const onlyVerified = c.req.query('verified') === 'true';

  const cacheKey = `reviews-summary:${id}:${onlyVerified ? 'verified' : 'all'}`;

  // const cached = await client.get(cacheKey);

  // if (cached) {
  //   return c.json(JSON.parse(cached), 200, {
  //     'Cache-Control': 'public, max-age=60',
  //   });
  // }

  const reviews = await Review.find({
    id,
    ...(onlyVerified && {
      verified: true,
    }),
  });

  if (!reviews) {
    c.status(200);
    return c.json({
      totalReviews: 0,
      averageRating: 0,
    });
  }

  const totalReviews = reviews.length;
  const totalRating = reviews.reduce((acc, r) => acc + r.rating, 0);
  const averageRating = totalRating / totalReviews;

  const summary = {
    totalReviews,
    averageRating,
  };

  await client.set(cacheKey, JSON.stringify(summary), {
    EX: 3600,
  });

  return c.json(summary, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

export default app;
