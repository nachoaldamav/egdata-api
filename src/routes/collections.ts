import { Hono } from 'hono';
import { Offer } from '../db/schemas/offer.js';
import { PriceEngine } from '../db/schemas/price-engine.js';
import { CollectionOffer } from '../db/schemas/collections.js';
import { getCookie } from 'hono/cookie';
import { regions } from '../utils/countries.js';
import client from '../clients/redis.js';

const app = new Hono();

app.get('/:slug', async (c) => {
  const { slug } = c.req.param();

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

  const cacheKey = `tops:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const collection = await CollectionOffer.findOne({
    _id: slug,
  });

  if (!collection || !collection.offers || collection.offers.length === 0) {
    c.status(404);
    return c.json({
      message: 'Collection not found',
    });
  }

  const totalOffersCount = collection.offers.length;
  const offersIds = collection.offers
    .map((o) => o.id)
    .filter((o) => o)
    .slice(skip, skip + limit);

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: offersIds },
    }),
    PriceEngine.find({
      offerId: { $in: offersIds },
      region,
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : [];
  const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

  const result = {
    elements: offers.map((o) => {
      const price = prices.find((p) => p.offerId === o.id);
      return {
        ...o.toObject(),
        price: price ?? null,
      };
    }),
    page,
    limit,
    total: totalOffersCount,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

export default app;
