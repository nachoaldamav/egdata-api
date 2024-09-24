import { Hono } from 'hono';
import { FreeGames } from '../db/schemas/freegames.js';
import { Offer } from '../db/schemas/offer.js';
import { orderOffersObject } from '../utils/order-offers-object.js';
import { PriceEngine } from '../db/schemas/price-engine.js';
import { regions } from '../utils/countries.js';
import { getCookie } from 'hono/cookie';
import client from '../clients/redis.js';
import { meiliSearchClient } from '../clients/meilisearch.js';

const app = new Hono();

app.get('/', async (c) => {
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

  const freeGames = await FreeGames.find(
    {
      endDate: { $gte: new Date() },
    },
    null,
    {
      sort: {
        endDate: 1,
      },
    }
  );

  const result = await Promise.all(
    freeGames.map(async (game) => {
      const [offerData, priceData, historicalData] = await Promise.allSettled([
        Offer.findOne({
          id: game.id,
        }),
        PriceEngine.findOne({
          offerId: game.id,
          region: region,
        }),
        FreeGames.find({
          id: game.id,
        }),
      ]);

      const offer = offerData.status === 'fulfilled' ? offerData.value : null;
      const price = priceData.status === 'fulfilled' ? priceData.value : null;
      const historical =
        historicalData.status === 'fulfilled' ? historicalData.value : [];

      if (!offer) {
        return {
          giveaway: game,
        };
      }

      return {
        ...orderOffersObject(offer?.toObject()),
        giveaway: { ...game.toObject(), historical },
        price: price ?? null,
      };
    })
  );

  return c.json(result, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.get('/history', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 25);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

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

  const cacheKey = `giveaways-history:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const freeGames = await FreeGames.find({}, null, {
    sort: {
      endDate: -1,
    },
    limit,
    skip,
  });

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: freeGames.map((g) => g.id) },
    }),
    PriceEngine.find({
      offerId: { $in: freeGames.map((g) => g.id) },
      region,
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : [];
  const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

  const result = await Promise.all(
    freeGames.map(async (game) => {
      const offer = offers.find((o) => o.id === game.id);
      const price = prices.find((p) => p.offerId === game.id);

      if (!offer) {
        return {
          giveaway: game,
        };
      }

      return {
        ...orderOffersObject(offer?.toObject()),
        price: price ?? null,
        giveaway: game,
      };
    })
  );

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.patch('/index', async (c) => {
  console.log('Refreshing MeiliSearch free games index');
  const index = meiliSearchClient.index('free-games');
  await index.deleteAllDocuments();

  const giveaways = await FreeGames.find({}, undefined, {
    sort: {
      endDate: -1,
    },
  });

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: giveaways.map((g) => g.id) },
    }),
    PriceEngine.find({
      offerId: { $in: giveaways.map((g) => g.id) },
      region: 'US',
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : [];
  const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

  const result = giveaways.map((g) => {
    const offer = offers.find((o) => o.id === g.id);
    const price = prices.find((p) => p.offerId === g.id);

    if (!offer) {
      return null;
    }

    return {
      ...orderOffersObject(offer),
      giveaway: g.toObject(),
      price: price ?? null,
    };
  });

  await index.addDocuments(
    result
      .filter((r) => r !== null)
      .map((o) => {
        return o;
      }),
    {
      primaryKey: '_id',
    }
  );

  return c.json({ message: 'ok' });
});

export default app;
