import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import * as jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import type { EpicTokenInfo } from './auth.js';

const app = new Hono();

const permissions = {
  admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  editor: ['GET', 'PUT', 'PATCH'],
  viewer: ['GET'],
};

type Admin = {
  userId: string;
  role: keyof typeof permissions;
};

const admin = createMiddleware<{
  Variables: Admin;
}>(async (c, next) => {
  const authCookie = getCookie(c, 'EGDATA_AUTH');

  if (!authCookie) {
    return c.json(
      {
        error: 'Unauthorized',
      },
      401
    );
  }

  const splitted = authCookie.split('.');

  if (splitted.length !== 2) {
    console.error('Invalid EGDATA_AUTH token');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Manually decode the token
  const decodedRaw = Buffer.from(splitted[0], 'base64').toString('utf-8');
  const decoded = JSON.parse(decodedRaw) as {
    user?: {
      accountId: string;
      accessToken: string;
    };
  };

  if (!decoded || !decoded.user?.accountId || !decoded.user?.accessToken) {
    console.error('Invalid EPIC_AUTH token', {
      authCookie: splitted[0].replace(/=+$/, ''),
      decoded,
    });
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const epicToken = jwt.decode(decoded.user.accessToken) as {
    sub: string;
    iss: string;
    dn: string;
    nonce: string;
    pfpid: string;
    sec: number;
    aud: string;
    t: string;
    scope: string;
    appid: string;
    exp: number;
    iat: number;
    jti: string;
  };

  if (!epicToken.dn || !epicToken.nonce || !epicToken.pfpid) {
    console.error('Invalid EPIC_AUTH token');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (epicToken.iss !== 'https://api.epicgames.dev/epic/oauth/v1') {
    console.error('Invalid EPIC_AUTH token');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const epicTokenInfo = await fetch(
    'https://api.epicgames.dev/epic/oauth/v2/tokenInfo',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: decoded.user.accessToken,
      }),
    }
  );

  if (!epicTokenInfo.ok) {
    console.error(
      'Failed to verify EPIC_AUTH token',
      await epicTokenInfo.json()
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const epicTokenInfoData = (await epicTokenInfo.json()) as EpicTokenInfo;

  if (!epicTokenInfoData.account_id || epicTokenInfoData.active !== true) {
    console.error('Failed to verify EPIC_AUTH token', epicTokenInfoData);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const user = await db.db.collection('epic').findOne({
    accountId: epicTokenInfoData.account_id,
  });

  if (!user) {
    console.error('User not found');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('role', user.role);
  c.set('userId', user.accountId);

  // Check if the user has the required permissions for the specified request
  if (
    !permissions[user.role as keyof typeof permissions] ||
    !permissions[user.role as keyof typeof permissions].includes(
      c.req.method as string
    )
  ) {
    return c.json({
      message: 'Unauthorized',
    });
  }

  await next();
});

app.get('/', admin, async (c) => {
  const role = c.get('role');

  if (!role) {
    return c.json({
      message: 'Unauthorized',
    });
  }

  if (!permissions[role]) {
    return c.json({
      message: 'Unauthorized',
    });
  }

  return c.json({
    role,
  });
});

app.post('/offers', admin, async (c) => {
  const body = await c.req.json();

  if (!body.id) {
    return c.json({ error: 'Missing id' }, 400);
  }

  const offer = await db.db.collection('offers').findOne({
    id: body.id,
  });

  if (offer) {
    return c.json({
      message: 'Offer already exists',
    });
  }

  await db.db.collection('offers').insertOne(body);

  return c.json({
    message: 'Offer created',
  });
});

app.patch('/offers', admin, async (c) => {
  const body = await c.req.json();

  if (!body.id) {
    return c.json({ error: 'Missing id' }, 400);
  }

  const offer = await db.db.collection('offers').findOne({
    id: body.id,
  });

  if (!offer) {
    return c.json({
      message: 'Offer not found',
    });
  }

  await db.db.collection('offers').updateOne(
    {
      id: body.id,
    },
    {
      $set: {
        ...body,
      },
    }
  );

  return c.json({
    message: 'Offer updated',
  });
});

export default app;
