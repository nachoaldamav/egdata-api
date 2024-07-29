import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import client from '../clients/redis';
import { Offer } from '../db/schemas/offer';
import { PriceEngine } from '../db/schemas/price-engine';
import { Tags } from '../db/schemas/tags';
import { regions } from '../utils/countries';
import { orderOffersObject } from '../utils/order-offers-object';
import { PipelineStage } from 'mongoose';

type SortBy =
  | 'releaseDate'
  | 'lastModifiedDate'
  | 'effectiveDate'
  | 'creationDate'
  | 'viewableDate'
  | 'pcReleaseDate'
  | 'upcoming'
  | 'price';

const app = new Hono();

app.get('/', async (c) => {
  const events = await Tags.find({
    groupName: 'event',
    status: 'ACTIVE',
  });

  return c.json(events, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.get('/:id', async (c) => {
  const { id } = c.req.param();
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 50);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

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

  const sortBy = (c.req.query('sortBy') ?? 'lastModifiedDate') as SortBy;
  const sortDir = (c.req.query('sortDir') ?? 'desc') as 'asc' | 'desc';

  const cacheKey = `promotion:${id}:${region}:${page}:${limit}:${sortBy}:${sortDir}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const event = await Tags.findOne({
    id,
  });

  if (!event) {
    c.status(404);
    return c.json({
      message: 'Event not found',
    });
  }

  const stages: PipelineStage[] = [];

  if (sortBy === 'price') {
    const priceStages: PipelineStage[] = [
      {
        $match: {
          region,
        },
      },
      {
        $sort: {
          'price.discountPrice': sortDir === 'asc' ? 1 : -1,
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
        $unwind: '$offer',
      },
      {
        $match: {
          'offer.tags': { $elemMatch: { id } },
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
          keyImages: '$offer.keyImages',
          price: '$price',
        },
      },
    ];

    stages.push(...priceStages);
  } else {
    const offerStages: PipelineStage[] = [
      {
        $match: {
          tags: { $elemMatch: { id } },
        },
      },
      {
        $sort: {
          [sortBy]: sortDir === 'asc' ? 1 : -1,
        },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
      {
        $unwind: {
          path: '$price',
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    stages.push(...offerStages);
  }

  const offersReq =
    sortBy === 'price'
      ? PriceEngine.aggregate(stages)
      : Offer.aggregate(stages);

  const offers = await offersReq;

  if (sortBy !== 'price') {
    const prices = await PriceEngine.find({
      region,
      offerId: { $in: offers.map((o) => o.id) },
    });

    offers.forEach((o) => {
      o.price = prices.find((p) => p.id === o.id) ?? null;
    });
  }

  const result: {
    elements: unknown[];
    title: string;
    start: number;
    page: number;
    count: number;
  } = {
    elements: offers,
    title: event.name ?? '',
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
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/:id/cover', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `promotion-cover:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
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
    'Cache-Control': 'public, max-age=60',
  });
});

export default app;
