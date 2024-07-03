import { createHash } from 'crypto';
import { Hono } from 'hono';
import client from '../clients/redis';
import { Offer } from '../db/schemas/offer';
import { orderOffersObject } from '../utils/order-offers-object';

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
    | 'pcReleaseDate';
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

  const cacheKey = `offers:search:${queryId}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const queryCache = `q:${queryId}`;

  const cachedQuery = await client.get(queryCache);

  if (!cachedQuery) {
    await client.set(queryCache, JSON.stringify(query));
  }

  const limit = Math.min(query.limit || 10, 50);

  const page = Math.max(query.page || 1, 1);

  const sort = query.sortBy || 'lastModifiedDate';

  const sortQuery = {
    lastModifiedDate: -1,
    releaseDate: -1,
    effectiveDate: -1,
    creationDate: -1,
    viewableDate: -1,
    pcReleaseDate: -1,
  };

  const mongoQuery: Record<string, any> = {};

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

  if (
    query.sortBy &&
    (query.sortBy === 'releaseDate' ||
      query.sortBy === 'pcReleaseDate' ||
      query.sortBy === 'effectiveDate')
  ) {
    // If any of those sorts are used, we need to ignore the offers that are from after 2090 (mock date for unknown dates)
    mongoQuery[query.sortBy] = { $lt: new Date('2090-01-01') };
  }

  if (!query.sortBy) {
    mongoQuery.lastModifiedDate = { $lt: new Date() };
  }

  console.log(mongoQuery);

  const offers = await Offer.find(mongoQuery, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      ...(query.title
        ? {
            score: { $meta: 'textScore' },
          }
        : {}),
      [sort]: sortQuery[sort],
    },
    collation: {
      locale: 'en',
      strength: 1,
      caseLevel: false,
      normalization: true,
      numericOrdering: true,
    },
  });

  const result = {
    elements: offers.map((o) => orderOffersObject(o)),
    page,
    limit,
    total: await Offer.countDocuments(mongoQuery),
    query: queryId,
  };

  return c.json(result, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

export default app;
