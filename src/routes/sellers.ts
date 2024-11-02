import { Hono } from 'hono';
import { Offer } from '@egdata/core.schemas.offers';
import { getCookie } from 'hono/cookie';
import { regions } from '../utils/countries.js';
import client from '../clients/redis.js';
import { PriceEngine } from '@egdata/core.schemas.price';
import { orderOffersObject } from '../utils/order-offers-object.js';
import { CollectionOffer } from '@egdata/core.schemas.collections';
import { Item } from '@egdata/core.schemas.items';
import { FreeGames } from '@egdata/core.schemas.free-games';
import { Seller } from '@egdata/core.schemas.sellers';

const app = new Hono();

app.get('/', async (c) => {
  const sellers = await Offer.distinct('seller');

  return c.json(sellers);
});

app.get('/:id', async (c) => {
  const { id } = c.req.param();
  const country = c.req.query('country');
  const limit = Number.parseInt(c.req.query('limit') || '0');
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const offerType = c.req.query('offerType');
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

  const cacheKey = `sellers:${id}:${region}:${page}:${limit}:${offerType}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const offers = await Offer.find(
    {
      'seller.id': id,
      ...(offerType ? { offerType } : {}),
    },
    undefined,
    {
      limit: limit === 0 ? undefined : limit,
      skip: (page - 1) * (limit === 0 ? 1 : limit),
      sort: {
        lastModifiedDate: -1,
      },
    }
  );

  const prices = await PriceEngine.find({
    offerId: { $in: offers.map((o) => o.id) },
    region,
  });

  const result = offers.map((o) => {
    const price = prices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price,
    };
  });

  return c.json(result);
});

app.get('/:id/cover', async (c) => {
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

  const cacheKey = `sellers:${id}:cover:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const topSellers = await CollectionOffer.findById('top-sellers');

  if (!topSellers) {
    c.status(404);
    return c.json({
      message: 'Top sellers collection not found',
    });
  }

  const offersInTopSellers = await Offer.find(
    {
      id: { $in: topSellers.offers.map((o) => o._id) },
      'seller.id': id,
    },
    undefined,
    {
      sort: {
        lastModifiedDate: -1,
      },
    }
  );

  let offers = offersInTopSellers.slice(0, 5);

  if (offers.length === 0) {
    // Just get the 1st offer from the seller
    offers = await Offer.find(
      {
        'seller.id': id,
      },
      undefined,
      {
        limit: 5,
        sort: {
          lastModifiedDate: -1,
        },
      }
    );
  }

  const prices = await PriceEngine.find({
    offerId: { $in: offers.map((o) => o.id) },
    region,
  });

  const result = offers.map((o) => {
    const price = prices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price,
    };
  });

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result);
});

app.get('/:id/stats', async (c) => {
  const { id } = c.req.param();

  const cacheKey = `sellers:${id}:stats:v1.0`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const seller = await Seller.findOne({ _id: id });

  if (!seller) {
    c.status(404);
    return c.json({
      message: 'Seller not found',
    });
  }

  const [offers, items, games, offersList] = await Promise.all([
    Offer.countDocuments({
      'seller.id': id,
    }),
    Item.countDocuments({
      developerId: id,
    }),
    Offer.countDocuments({
      'seller.id': id,
      offerType: 'BASE_GAME',
    }),
    Offer.find({
      'seller.id': id,
    }),
  ]);

  const freegames = await FreeGames.countDocuments({
    id: {
      $in: offersList.map((o) => o.id),
    },
  });

  const result = {
    offers,
    items,
    games,
    freegames,
    seller,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result);
});

export default app;
