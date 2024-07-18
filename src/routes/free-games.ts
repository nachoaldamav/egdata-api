import { Hono } from 'hono';
import { FreeGames } from '../db/schemas/freegames';
import { Offer } from '../db/schemas/offer';
import { orderOffersObject } from '../utils/order-offers-object';

const app = new Hono();

app.get('/', async (c) => {
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
      const offer = await Offer.findOne({
        id: game.id,
      });

      if (!offer) {
        return {
          giveaway: game,
        };
      }

      return {
        ...orderOffersObject(offer?.toObject()),
        giveaway: game,
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
