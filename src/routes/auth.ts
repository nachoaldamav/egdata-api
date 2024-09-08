import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import * as jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { db } from '../db/index.js';

interface EpicProfileResponse {
  accountId: string;
  displayName: string;
  preferredLanguage: string;
  linkedAccounts?: LinkedAccount[];
}

interface LinkedAccount {
  identityProviderId: string;
  displayName: string;
}

const getEpicAccount = async (accessToken: string, accountId: string) => {
  const url = new URL('https://api.epicgames.dev/epic/id/v2/accounts');
  url.searchParams.append('accountId', accountId);

  const response = (await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => r.json())) as EpicProfileResponse[];

  return response[0];
};

const app = new Hono();

app.use(cors());

interface EpicTokenInfo {
  active: boolean;
  scope: string;
  token_type: string;
  expires_in: number;
  expires_at: string;
  account_id: string;
  client_id: string;
  application_id: string;
  access_token: string;
}

type EpicAuthMiddleware = {
  Variables: {
    epic?: EpicTokenInfo;
  };
};

export const epic = createMiddleware<EpicAuthMiddleware>(async (c, next) => {
  // Get the authorization header or cookie "EPIC_AUTH"
  let epicAuth = c.req.header('Authorization') || getCookie(c, 'EPIC_AUTH');

  if (!epicAuth) {
    console.error('Missing EPIC_AUTH header or cookie');
    return c.json({ error: 'Missing EPIC_AUTH header or cookie' }, 401);
  }

  if (epicAuth.startsWith('Bearer ')) {
    epicAuth = epicAuth.replace('Bearer ', '');
  }

  try {
    const decoded = jwt.decode(epicAuth) as
      | ({
          sub: string;
          appid: string;
        } & jwt.JwtHeader & { header: { kid: string } })
      | null;

    if (!decoded || !decoded.sub || !decoded.appid) {
      console.error('Invalid EPIC_AUTH token');
      return c.json({ error: 'Invalid EPIC_AUTH token' }, 401);
    }

    // Verify the token
    const epicTokenInfo = await fetch(
      'https://api.epicgames.dev/epic/oauth/v2/tokenInfo',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: epicAuth,
        }),
      }
    );

    if (!epicTokenInfo.ok) {
      console.error(
        'Failed to verify EPIC_AUTH token',
        await epicTokenInfo.json()
      );
      return c.json({ error: 'Failed to verify EPIC_AUTH token' }, 401);
    }

    const epicTokenInfoData = (await epicTokenInfo.json()) as EpicTokenInfo;

    if (!epicTokenInfoData.account_id || epicTokenInfoData.active !== true) {
      console.error('Failed to verify EPIC_AUTH token', epicTokenInfoData);
      return c.json({ error: 'Failed to verify EPIC_AUTH token' }, 401);
    }

    c.set('epic', {
      ...epicTokenInfoData,
      access_token: epicAuth,
    });

    return next();
  } catch (err) {
    console.error('Error verifying EPIC_AUTH token', err);
    return c.json({ error: 'Invalid EPIC_AUTH token' }, 401);
  }
});

/**
 * Same middleware, but it's used to get the account ID
 */
export const epicInfo = createMiddleware<EpicAuthMiddleware>(
  async (c, next) => {
    // Get the authorization header or cookie "EPIC_AUTH"
    let epicAuth = c.req.header('Authorization') || getCookie(c, 'EPIC_AUTH');

    if (!epicAuth) {
      console.error('Missing EPIC_AUTH header or cookie');
      return next();
    }

    if (epicAuth.startsWith('Bearer ')) {
      epicAuth = epicAuth.replace('Bearer ', '');
    }

    try {
      const decoded = jwt.decode(epicAuth) as
        | ({
            sub: string;
            appid: string;
          } & jwt.JwtHeader & { header: { kid: string } })
        | null;

      if (!decoded || !decoded.sub || !decoded.appid) {
        console.error('Invalid EPIC_AUTH token');
        return next();
      }

      // Verify the token
      const epicTokenInfo = await fetch(
        'https://api.epicgames.dev/epic/oauth/v2/tokenInfo',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            token: epicAuth,
          }),
        }
      );

      if (!epicTokenInfo.ok) {
        console.error(
          'Failed to verify EPIC_AUTH token',
          await epicTokenInfo.json()
        );
        return next();
      }

      const epicTokenInfoData = (await epicTokenInfo.json()) as EpicTokenInfo;

      if (!epicTokenInfoData.account_id || epicTokenInfoData.active !== true) {
        console.error('Failed to verify EPIC_AUTH token', epicTokenInfoData);
        return next();
      }

      c.set('epic', {
        ...epicTokenInfoData,
        access_token: epicAuth,
      });

      return next();
    } catch (err) {
      console.error('Error verifying EPIC_AUTH token', err);
      return next();
    }
  }
);

app.get('/', epic, async (c) => {
  const epic = c.var.epic;

  if (!epic || !epic.account_id) {
    console.error('Missing EPIC_ACCOUNT_ID', epic);
    return c.json({ error: 'Missing EPIC_ACCOUNT_ID' }, 401);
  }

  // Save or create a new 'epic' entry in the database
  const epicEntry = await db.db.collection('epic').findOne({
    accountId: epic.account_id,
  });

  if (epicEntry) {
    return c.json(epicEntry);
  }

  console.warn('No epic entry found, fetching from Epic Games', {
    accountId: epic.account_id,
  });

  const epicProfile = await getEpicAccount(epic.access_token, epic.account_id);

  if (!epicProfile) {
    console.error('Failed to fetch Epic profile', {
      epic,
    });
    return c.json({ error: 'Failed to fetch Epic profile' }, 401);
  }

  await db.db.collection('epic').insertOne({
    ...epicProfile,
    creationDate: new Date(),
  });

  return c.json(epicProfile);
});

app.post('/avatar', epic, async (c) => {
  const epicVar = c.var.epic;

  if (!epicVar || !epicVar.account_id) {
    console.error('Missing EPIC_ACCOUNT_ID', epicVar);
    return c.json({ error: 'Missing EPIC_ACCOUNT_ID' }, 401);
  }

  console.log('Content type:', c.req.header('Content-Type'));

  const body = await c.req.parseBody();

  const file = body.file as File;

  if (!file) {
    console.error('Missing file');
    return c.json({ error: 'Missing file' }, 400);
  }

  const cfImagesUrl =
    'https://api.cloudflare.com/client/v4/accounts/7da0b3179a5b5ef4f1a2d1189f072d0b/images/v1';
  const accessToken = process.env.CF_IMAGES_KEY;

  const formData = new FormData();
  formData.set(
    'file',
    file,
    `${epicVar.account_id}.${file.name.split('.').pop()}`
  );

  const response = await fetch(cfImagesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    console.error('Failed to upload avatar', await response.json());
    return c.json({ error: 'Failed to upload avatar' }, 400);
  }

  const responseData = await response.json();

  await db.db.collection('epic').updateOne(
    {
      accountId: epicVar.account_id,
    },
    {
      $set: {
        avatarUrl: responseData.result,
      },
    }
  );

  return c.json(responseData.result);
});

app.post('/persist', epic, async (c) => {
  const epicVar = c.var.epic;

  if (!epicVar || !epicVar.account_id) {
    console.error('Missing EPIC_ACCOUNT_ID', epicVar);
    return c.json({ error: 'Missing EPIC_ACCOUNT_ID' }, 401);
  }

  const body = await c.req.json();

  const { refreshToken } = body;

  const decoded = jwt.decode(refreshToken) as {
    jti: string;
  };

  const tokenId = decoded.jti;

  if (!refreshToken || !tokenId) {
    console.error('Malformed request');
    return c.json({ error: 'Malformed request' }, 400);
  }

  const accessTokenIntrospection = await fetch(
    'https://api.epicgames.dev/epic/oauth/v2/tokenInfo',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: epicVar.access_token,
      }),
    }
  ).then(
    (r) =>
      r.json() as Promise<{
        active: boolean;
        scope: string;
        token_type: string;
        expires_in: number;
        expires_at: string;
        account_id: string;
        client_id: string;
        application_id: string;
      }>
  );

  const refreshTokenIntrospection = await fetch(
    'https://api.epicgames.dev/epic/oauth/v2/tokenInfo',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: refreshToken,
      }),
    }
  ).then(
    (r) =>
      r.json() as Promise<{
        active: boolean;
        scope: string;
        token_type: string;
        expires_in: number;
        expires_at: string;
        account_id: string;
        client_id: string;
        application_id: string;
      }>
  );

  if (!accessTokenIntrospection.active || !refreshTokenIntrospection.active) {
    console.error('Invalid tokens');
    return c.json({ error: 'Invalid tokens' }, 401);
  }

  if (
    accessTokenIntrospection.account_id !== refreshTokenIntrospection.account_id
  ) {
    console.error('Tokens are not for the same account');
    return c.json({ error: 'Tokens are not for the same account' }, 401);
  }

  const entry = await db.db.collection('tokens').updateOne(
    {
      tokenId,
    },
    {
      $set: {
        accessToken: epicVar.access_token,
        refreshToken: refreshToken,
        expiresAt: new Date(
          Date.now() + accessTokenIntrospection.expires_in * 1000
        ),
        refreshExpiresAt: new Date(
          Date.now() + refreshTokenIntrospection.expires_in * 1000
        ),
        accountId: epicVar.account_id,
      },
    },
    {
      upsert: true,
    }
  );

  return c.json(
    {
      id: entry.upsertedId,
      status: 'ok',
    },
    200
  );
});

app.get('/refresh', async (c) => {
  // Decode JWT token from authorization header manually as the tokens is probably expired
  const authorization = c.req.header('Authorization');

  if (!authorization) {
    console.error('Missing authorization header');
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const authToken = authorization.replace('Bearer ', '');

  if (!authToken) {
    console.error('Missing token');
    return c.json({ error: 'Missing token' }, 401);
  }

  const decoded = jwt.decode(authToken, {}) as {
    sub: string;
    iss: string;
  };

  if (!decoded || !decoded.sub || !decoded.iss) {
    console.error('Invalid token');
    return c.json({ error: 'Invalid token' }, 401);
  }

  if (!decoded.iss.startsWith('https://api.epicgames.dev/epic/')) {
    console.error('Token issuer invalid', decoded.iss);
    return c.json({ error: 'Invalid token' }, 401);
  }

  const id = c.req.query('id');

  if (!id) {
    console.error('Missing id parameter');
    return c.json({ error: 'Missing id parameter' }, 400);
  }

  let token = await db.db.collection('tokens').findOne({
    _id: new ObjectId(id),
    accountId: decoded.sub,
  });

  if (!token) {
    console.error('Token not found');
    return c.json({ error: 'Token not found' }, 404);
  }

  let expired = false;

  // Check if the token is expired, if so, refresh it
  if (token.expiresAt < new Date()) {
    expired = true;
    const url = new URL('https://api.epicgames.dev/epic/oauth/v2/token');
    url.searchParams.append('grant_type', 'refresh_token');
    url.searchParams.append('refresh_token', token.refreshToken);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: token.refreshToken,
      }),
    });

    if (!response.ok) {
      console.error('Failed to refresh token', await response.json());
      return c.json({ error: 'Failed to refresh token' }, 401);
    }

    const responseData = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      refresh_expires_at: string;
      expires_at: string;
    };

    await db.db.collection('tokens').updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          accessToken: responseData.access_token,
          refreshToken: responseData.refresh_token,
          expiresAt: new Date(responseData.expires_at),
          refreshExpiresAt: new Date(responseData.refresh_expires_at),
        },
      },
      {
        upsert: true,
      }
    );
  }

  if (expired) {
    token = await db.db.collection('tokens').findOne({
      _id: new ObjectId(id),
    });
  }

  console.log(`Refreshed token for ${decoded.sub}`);

  return c.json(
    {
      accessToken: token?.accessToken,
      refreshToken: token?.refreshToken,
      expiresAt: token?.expiresAt,
      refreshExpiresAt: token?.refreshExpiresAt,
    },
    200
  );
});

app.patch('/refresh', async (c) => {
  // Get the authorization header and compare it to 'JWT_SECRET' env variable
  const authorization = c.req.header('Authorization');

  if (!authorization) {
    console.error('Missing authorization header');
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const token = authorization.replace('Bearer ', '');

  if (!token) {
    console.error('Missing token');
    return c.json({ error: 'Missing token' }, 401);
  }

  if (token !== process.env.JWT_SECRET) {
    console.error('Invalid token');
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Refresh tokens that are expired or about to expire (within 10 minutes)
  const tokens = await db.db
    .collection('tokens')
    .find({
      expiresAt: { $lt: new Date() },
      refreshExpiresAt: { $lt: new Date(Date.now() + 10 * 60 * 1000) },
    })
    .toArray();

  const clientId = process.env.EPIC_CLIENT_ID;
  const clientSecret = process.env.EPIC_CLIENT_SECRET;

  for (const token of tokens) {
    console.log('Refreshing token', token.tokenId);

    if (token.refreshExpiresAt < new Date()) {
      console.log('Refresh token expired, removing from DB');
      await db.db.collection('tokens').deleteOne({
        tokenId: token.tokenId,
      });
      continue;
    }

    try {
      const url = new URL('https://api.epicgames.dev/epic/oauth/v2/token');

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${clientId}:${clientSecret}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refreshToken,
          scope: 'basic_profile',
        }),
      });

      if (!response.ok) {
        console.error('Failed to refresh token', await response.json());

        // Remove the token from the DB
        await db.db.collection('tokens').deleteOne({
          tokenId: token.tokenId,
        });

        continue;
      }

      const responseData = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        refresh_expires_at: string;
        expires_at: string;
      };

      const expiresAt = new Date(responseData.expires_at);
      const refreshExpiresAt = new Date(responseData.refresh_expires_at);

      await db.db.collection('tokens').updateOne(
        {
          tokenId: token.tokenId,
        },
        {
          $set: {
            accessToken: responseData.access_token,
            refreshToken: responseData.refresh_token,
            expiresAt,
            refreshExpiresAt,
          },
        },
        {
          upsert: false,
        }
      );
    } catch (err) {
      // Revoke the token and delete it from the database
      const url = new URL('https://api.epicgames.dev/epic/oauth/v2/revoke');
      url.searchParams.append('token', token.refreshToken);
      await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: token.refreshToken,
        }),
      }).catch((err) => {
        console.error('Failed to revoke token', err);
      });

      await db.db.collection('tokens').deleteOne({
        tokenId: token.tokenId,
      });
    }
  }

  return c.json(
    {
      status: 'ok',
    },
    200
  );
});

export default app;
