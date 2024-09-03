import { Hono } from 'hono';
import { epicStoreClient } from '../clients/epic.js';
import client from '../clients/redis.js';

const app = new Hono();

app.get('/:id', async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const cacheKey = `epic-profile:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  try {
    const profile = await epicStoreClient.getUser(id);

    if (!profile) {
      c.status(404);
      return c.json({
        message: 'Profile not found',
      });
    }

    const achievements = await epicStoreClient.getUserAchievements(id);

    const result = {
      ...profile,
      achievements,
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 3600,
    });

    return c.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    console.error('Error fetching profile', err);
    c.status(400);
    return c.json({
      message: 'Failed to fetch profile',
    });
  }
});

export default app;
