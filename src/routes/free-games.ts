import { Hono } from 'hono';
import { FreeGames } from '../db/schemas/freegames';
import { Offer } from '../db/schemas/offer';
import { orderOffersObject } from '../utils/order-offers-object';
import { PriceEngine } from '../db/schemas/price-engine';
import { regions } from '../utils/countries';
import { getCookie } from 'hono/cookie';

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
  const freeGames = await FreeGames.find({}, null, {
    sort: {
      endDate: -1,
    },
  });

  const result = await Promise.all(
    freeGames.map(async (game) => {
      const offer = await Offer.findOne({
        id: game.id,
      });

      return {
        title: offer?.title ?? 'Unknown',
        giveaway: game,
      };
    })
  );

  return c.json(result, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

export default app;
