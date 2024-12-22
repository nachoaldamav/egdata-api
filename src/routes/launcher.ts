import { Hono } from 'hono';
import { db } from '../db/index.js';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';

const app = new Hono();

const BASE_URL = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared'

export const epicInfo = createMiddleware(
  async (c, next) => {
    // Get the authorization header or cookie "EPIC_AUTH"
    let epicAuth = c.req.header('Authorization') || getCookie(c, 'EGDATA_AUTH');

    if (!epicAuth) {
      console.error('Missing EPIC_AUTH header or cookie');
      return c.json({ error: 'Missing EPIC_AUTH header or cookie' }, 401);
    }

    if (epicAuth.startsWith('Bearer ')) {
      epicAuth = epicAuth.replace('Bearer ', '');
    }

    const certificate = process.env.JWT_PUBLIC_KEY;

  if (!certificate) {
    console.error('Missing JWT_PUBLIC_KEY env variable');
    return c.json({ error: 'Missing JWT_PUBLIC_KEY env variable' }, 401);
  }

    try {
      const verified = jwt.verify(epicAuth, readFileSync(certificate, 'utf-8'), {
        algorithms: ['RS256'],
      });

      console.log('Verified JWT', verified);

      if (!verified || verified.client_id !== 'xyza7891xZ38uWZ6zLt8enN8oNxlLvWf') {
        console.error('Invalid JWT');
        return c.json({ error: 'Invalid JWT' }, 401);
      }

      c.set('epic', verified);

      return next();
    } catch (err) {
      console.error('Error verifying EPIC_AUTH token', err);
      return next();
    }
  }
);

app.use('/*', epicInfo);

app.get('/sandbox/:id', async (c) => {
  const { id } = c.req.param();

  const user = await db.db.collection('launcher').findOne<LauncherAuthTokens>({
      account_id: process.env.ADMIN_ACCOUNT_ID,
    });

  const url = new URL(`${BASE_URL}/namespaces/${id}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user?.access_token}`,
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch sandbox', await response.json());
    return c.json({ error: 'Failed to fetch sandbox' }, 400);
  }

  const responseData = await response.json()

  return c.json(responseData, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/sandbox/:id/items', async (c) => {
  const { id } = c.req.param();
  const queryParams = c.req.query();

  const user = await db.db.collection('launcher').findOne<LauncherAuthTokens>({
      account_id: process.env.ADMIN_ACCOUNT_ID,
    });

  const url = new URL(`${BASE_URL}/namespace/${id}/items`);

  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.append(key, value);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user?.access_token}`,
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch sandbox items', await response.json());
    return c.json({ error: 'Failed to fetch sandbox items' }, 400);
  }

  const responseData = await response.json()

  return c.json(responseData, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

app.get('/sandbox/:id/offers', async (c) => {
  const { id } = c.req.param();
  const queryParams = c.req.query();

  const user = await db.db.collection('launcher').findOne<LauncherAuthTokens>({
      account_id: process.env.ADMIN_ACCOUNT_ID,
    });

  const url = new URL(`${BASE_URL}/namespace/${id}/offers`);

  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.append(key, value);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user?.access_token}`,
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch sandbox offers', await response.json());
    return c.json({ error: 'Failed to fetch sandbox offers' }, 400);
  }

  const responseData = await response.json()

  return c.json(responseData, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

export default app;