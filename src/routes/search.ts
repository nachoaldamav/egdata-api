import { createHash } from 'crypto';
import { Hono } from 'hono';
import client from '../clients/redis';
import { Offer } from '../db/schemas/offer';
import { Tags } from '../db/schemas/tags';
import { PipelineStage } from 'mongoose';
import { regions } from '../utils/countries';
import { getCookie } from 'hono/cookie';
import { db } from '../db';
import { inspect } from 'util';

interface SearchBody {
  title?: string;
  offerType?:
    | 'IN_GAME_PURCHASE'
    | 'BASE_GAME'
    | 'EXPERIENCE'
    | 'UNLOCKABLE'
    | 'ADD_ON'
    | 'Bundle'
    | 'CONSUMABLE'
    | 'WALLET'
    | 'OTHERS'
    | 'DEMO'
    | 'DLC'
    | 'VIRTUAL_CURRENCY'
    | 'BUNDLE'
    | 'DIGITAL_EXTRA'
    | 'EDITION';
  tags?: string[];
  customAttributes?: string[];
  seller?: string;
  sortBy?:
    | 'releaseDate'
    | 'lastModifiedDate'
    | 'effectiveDate'
    | 'creationDate'
    | 'viewableDate'
    | 'pcReleaseDate'
    | 'upcoming'
    | 'priceAsc'
    | 'priceDesc'
    | 'price';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  page?: number;
  refundType?: string;
  isCodeRedemptionOnly?: boolean;
  price?: {
    min?: number;
    max?: number;
  };
  onSale?: boolean;
}

const app = new Hono();

app.get('/', (c) => c.json('Hello, World!'));

app.post('/', async (c) => {
  const start = new Date();

  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region =
    Object.keys(regions).find((r) =>
      regions[r].countries.includes(selectedCountry)
    ) || 'US';

  const body = await c.req.json().catch((err) => {
    c.status(400);
    return null;
  });

  if (!body) {
    return c.json({
      message: 'Invalid body',
    });
  }

  const query = body as SearchBody;

  const queryId = createHash('md5')
    .update(
      JSON.stringify({
        ...query,
        page: undefined,
        limit: undefined,
      })
    )
    .digest('hex');

  const cacheKey = `offers:search:${queryId}:${region}:${query.page}:${query.limit}:v0.1`;

  // const cached = await client.get(cacheKey);

  // if (cached) {
  //   console.warn(`Cache hit for ${cacheKey}`);
  //   return c.json(JSON.parse(cached), 200, {
  //     'Cache-Control': 'public, max-age=60',
  //   });
  // }

  console.warn(`Cache miss for ${cacheKey}`);

  const queryCache = `q:${queryId}`;

  const cachedQuery = await client.get(queryCache);

  if (!cachedQuery) {
    console.warn(`Cache miss for ${queryCache}`);
    await client.set(queryCache, JSON.stringify(query));
  } else {
    console.warn(`Cache hit for ${queryCache}`);
  }

  const limit = Math.min(query.limit || 10, 50);

  const page = Math.max(query.page || 1, 1);

  const sort = query.sortBy || 'lastModifiedDate';
  const sortDir = query.sortDir || 'desc';
  const dir = sortDir === 'asc' ? 1 : -1;

  const sortQuery = {
    lastModifiedDate: dir,
    releaseDate: dir,
    effectiveDate: dir,
    creationDate: dir,
    viewableDate: dir,
    pcReleaseDate: dir,
  };

  const mongoQuery: Record<string, any> = {};
  const priceQuery: Record<string, any> = {};

  if (query.title) {
    mongoQuery['$text'] = {
      $search: query.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(' ')
        .map((q) => `"${q.trim()}"`)
        .join(' | '),
      $language: 'en',
    };
  }

  if (query.offerType) {
    mongoQuery.offerType = query.offerType;
  }

  /**
   * tags provided by the user are tags.id, so we just need to check the tags array of the offers to find the offers that have the tags
   */
  if (query.tags) {
    mongoQuery['tags.id'] = { $all: query.tags };
  }

  if (query.customAttributes) {
    mongoQuery.customAttributes = {
      $elemMatch: { id: { $in: query.customAttributes } },
    };
  }

  /**
   * The seller is the ID of the seller, so we just need to check the seller.id field in the offers
   */
  if (query.seller) {
    mongoQuery['seller.id'] = query.seller;
  }

  if (query.refundType) {
    mongoQuery.refundType = query.refundType;
  }

  if (query.isCodeRedemptionOnly !== undefined) {
    mongoQuery.isCodeRedemptionOnly = query.isCodeRedemptionOnly;
  }

  if (['effectiveDate', 'creationDate', 'viewableDate'].includes(sort)) {
    // If any of those sorts are used, we need to ignore the offers that are from after 2090 (mock date for unknown dates)
    mongoQuery[sort] = { $lt: new Date('2090-01-01') };
  }

  if (['releaseDate', 'pcReleaseDate'].includes(sort)) {
    // If the sort is releaseDate or pcReleaseDate, we need to ignore the offers that are from after the current date
    mongoQuery[sort] = { $lte: new Date() };
  }

  if (['upcoming'].includes(sort)) {
    // If the sort is upcoming, we need to ignore the offers that are from before the current date
    mongoQuery['releaseDate'] = {
      $gte: new Date(),
    };
  }

  if (!sort) {
    mongoQuery.lastModifiedDate = { $lt: new Date() };
  }

  if (query.price) {
    if (query.price.min) {
      priceQuery['price.discountPrice'] = {
        $gte: query.price.min,
      };
    }

    if (query.price.max) {
      priceQuery['price.discountPrice'] = {
        ...priceQuery['price.discountPrice'],
        $lte: query.price.max,
      };
    }
  }

  if (query.onSale) {
    priceQuery['price.discount'] = { $gt: 0 };
  }

  const sortingParams = () => {
    let sortParams = {};

    if (query.title) {
      sortParams = {
        score: { $meta: 'textScore' },
      };
    }

    if (!['upcoming', 'priceAsc', 'priceDesc'].includes(sort)) {
      // @ts-expect-error
      sortParams[sort] = sortQuery[sort];
    } else if (sort === 'upcoming') {
      sortParams = {
        releaseDate: dir === 1 ? 1 : -1,
      };
    } else {
      sortParams = {
        lastModifiedDate: dir,
      };
    }

    return sortParams;
  };

  let offersPipeline: PipelineStage[] = [];
  let collection = 'offers';

  if (['priceAsc', 'priceDesc', 'price'].includes(sort)) {
    // If sorting by price, start with the pricing collection
    // const priceSortOrder = sort === 'priceAsc' ? 1 : -1;
    const priceSortOrder =
      sort === 'priceAsc' || sort === 'priceDesc'
        ? sort === 'priceAsc'
          ? 1
          : -1
        : dir;

    collection = 'pricev2';
    offersPipeline = [
      {
        $match: {
          region: region,
          ...priceQuery,
        },
      },
      {
        $sort: {
          'price.discountPrice': priceSortOrder,
        },
      },
      // Move the root content (all of it) to the price field
      {
        $addFields: {
          price: '$$ROOT',
        },
      },
      {
        $lookup: {
          from: 'offers',
          localField: 'offerId',
          foreignField: 'id',
          as: 'offerDetails',
        },
      },
      {
        $unwind: '$offerDetails',
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ['$offerDetails', '$$ROOT'],
          },
        },
      },
      {
        $match: mongoQuery,
      },
      {
        $skip: (page - 1) * limit,
      },
      {
        $limit: limit,
      },
      {
        $project: {
          discountPrice: 0,
          offerDetails: 0,
          appliedRules: 0,
          region: 0,
          country: 0,
          offerId: 0,
          updatedAt: 0,
        },
      },
    ];
  } else {
    // If not sorting by price, use the original pipeline
    offersPipeline = [
      {
        $match: mongoQuery,
      },
      {
        $sort: {
          ...(query.title ? { score: { $meta: 'textScore' } } : {}),
          ...sortingParams(),
        },
      },
      {
        $lookup: {
          from: 'pricev2',
          localField: 'id',
          foreignField: 'offerId',
          as: 'priceEngine',
          pipeline: [
            {
              $match: {
                region: region,
                ...priceQuery,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          price: { $arrayElemAt: ['$priceEngine', 0] },
        },
      },
      {
        $match: {
          price: { $ne: null },
        },
      },
      {
        $project: {
          priceEngine: 0,
        },
      },
      {
        $skip: (page - 1) * limit,
      },
      {
        $limit: limit,
      },
    ];
  }

  console.log(inspect(offersPipeline, false, null, true));

  const offersData = await db.db
    .collection(collection)
    .aggregate(offersPipeline)
    .toArray();

  const result = {
    elements: offersData,
    page,
    limit,
    query: queryId,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get('/tags', async (c) => {
  const tags = await Tags.find({
    status: 'ACTIVE',
  });

  return c.json(tags, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/offer-types', async (c) => {
  const types = await Offer.aggregate([
    { $group: { _id: '$offerType', count: { $sum: 1 } } },
  ]);

  return c.json(
    types.filter((t) => t._id),
    200,
    {
      'Cache-Control': 'public, max-age=60',
    }
  );
});

app.get('/:id/count', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region =
    Object.keys(regions).find((r) =>
      regions[r].countries.includes(selectedCountry)
    ) || 'US';

  const { id } = c.req.param();

  const queryKey = `q:${id}`;

  const cacheKey = `search:count:${id}:${region}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  }

  const cachedQuery = await client.get(queryKey);

  if (!cachedQuery) {
    c.status(404);
    return c.json({
      message: 'Query not found',
    });
  }

  const query = JSON.parse(cachedQuery);

  const mongoQuery: Record<string, any> = {};
  const priceQuery: Record<string, any> = {};

  if (query.title) {
    mongoQuery.title = { $regex: new RegExp(query.title, 'i') };
  }

  if (query.offerType) {
    mongoQuery.offerType = query.offerType;
  }

  /**
   * The tags query should be "and", so we need to find the offers that have all the tags provided by the user
   */
  if (query.tags) {
    mongoQuery['tags.id'] = { $all: query.tags };
  }

  if (query.customAttributes) {
    mongoQuery.customAttributes = {
      $elemMatch: { id: { $in: query.customAttributes } },
    };
  }

  if (query.seller) {
    mongoQuery['seller.id'] = query.seller;
  }

  if (query.refundType) {
    mongoQuery.refundType = query.refundType;
  }

  if (query.isCodeRedemptionOnly !== undefined) {
    mongoQuery.isCodeRedemptionOnly = query.isCodeRedemptionOnly;
  }

  if (query.price) {
    if (query.price.min) {
      priceQuery['price.discountPrice'] = {
        $gte: query.price.min,
      };
    }

    if (query.price.max) {
      priceQuery['price.discountPrice'] = {
        ...priceQuery['price.discountPrice'],
        $lte: query.price.max,
      };
    }
  }

  if (query.onSale) {
    priceQuery['price.discount'] = { $gt: 0 };
  }

  try {
    const [tagCountsData, offerTypeCountsData, totalCountData] =
      await Promise.allSettled([
        Offer.aggregate([
          { $match: mongoQuery },
          {
            $lookup: {
              from: 'pricev2',
              localField: 'id',
              foreignField: 'offerId',
              as: 'priceEngine',
              pipeline: [
                {
                  $match: {
                    region: 'EURO',
                    ...priceQuery,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              price: { $arrayElemAt: ['$priceEngine', 0] },
            },
          },
          {
            $match: {
              price: { $ne: null },
            },
          },
          { $unwind: '$tags' },
          { $group: { _id: '$tags.id', count: { $sum: 1 } } },
        ]),
        Offer.aggregate([
          { $match: mongoQuery },
          {
            $lookup: {
              from: 'pricev2',
              localField: 'id',
              foreignField: 'offerId',
              as: 'priceEngine',
              pipeline: [
                {
                  $match: {
                    region: 'EURO',
                    ...priceQuery,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              price: { $arrayElemAt: ['$priceEngine', 0] },
            },
          },
          {
            $match: {
              price: { $ne: null },
            },
          },
          { $group: { _id: '$offerType', count: { $sum: 1 } } },
        ]),
        Offer.aggregate([
          { $match: mongoQuery },
          // Append the price query to the pipeline
          {
            $lookup: {
              from: 'pricev2',
              localField: 'id',
              foreignField: 'offerId',
              as: 'priceEngine',
              pipeline: [
                {
                  $match: {
                    region: 'EURO',
                    ...priceQuery,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              price: { $arrayElemAt: ['$priceEngine', 0] },
            },
          },
          {
            $match: {
              price: { $ne: null },
            },
          },
          {
            $count: 'total',
          },
        ]),
      ]);

    const result = {
      tagCounts:
        tagCountsData.status === 'fulfilled' ? tagCountsData.value : [],
      offerTypeCounts:
        offerTypeCountsData.status === 'fulfilled'
          ? offerTypeCountsData.value
          : [],
      total:
        totalCountData.status === 'fulfilled'
          ? totalCountData.value[0]?.total
          : 0,
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 86400,
    });

    return c.json(result, 200, {
      'Cache-Control': 'public, max-age=3600',
    });
  } catch (err) {
    c.status(500);
    c.json({ message: 'Error while counting tags' });
  }
});

app.get('/:id', async (c) => {
  const { id } = c.req.param();

  const queryKey = `q:${id}`;

  const cachedQuery = await client.get(queryKey);

  if (!cachedQuery) {
    c.status(404);
    return c.json({
      message: 'Query not found',
    });
  }

  return c.json(JSON.parse(cachedQuery));
});

export default app;
