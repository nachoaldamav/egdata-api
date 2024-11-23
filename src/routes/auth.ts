import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import * as jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { db } from '../db/index.js';
import { readFileSync } from 'node:fs';
import { telegramBotService } from '../clients/telegram.js';

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

export interface EpicTokenInfo {
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
    aud: string;
  };

  if (!decoded || !decoded.sub || !decoded.iss) {
    console.error('Invalid token', decoded);
    return c.json({ error: 'Invalid token' }, 401);
  }

  if (!decoded.iss.startsWith('https://api.epicgames.dev/epic/')) {
    console.error('Token issuer invalid', decoded.iss);
    return c.json({ error: 'Invalid token' }, 401);
  }

  const aud = decoded.aud;

  const clientId = process.env.EPIC_CLIENT_ID;
  const clientSecret = process.env.EPIC_CLIENT_SECRET;

  if (aud !== clientId) {
    console.error('Client issuer invalid', aud);
    return c.json({ error: 'Invalid token' }, 401);
  }

  const id = c.req.query('id');

  if (!id) {
    console.error('Missing id parameter');
    return c.json({ error: 'Missing id parameter' }, 400);
  }

  let token = await db.db
    .collection<{
      accessToken: string;
      refreshToken: string;
      expiresAt: Date;
      refreshExpiresAt: Date;
      accountId: string;
    }>('tokens')
    .findOne({
      _id: new ObjectId(id),
      accountId: decoded.sub,
    });

  if (!token) {
    console.error('Token not found');
    return c.json({ error: 'Token not found' }, 404);
  }

  let expired = false;

  // Check if the token is expired, if so, refresh it
  if (token.expiresAt.getTime() < new Date().getTime()) {
    expired = true;
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
    token = await db.db
      .collection<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        refreshExpiresAt: Date;
        accountId: string;
      }>('tokens')
      .findOne({
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
      expiresAt: { $lt: new Date(Date.now() + 10 * 60 * 1000) },
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

        await telegramBotService.sendMessage(
          `Failed to refresh token for ${token.tokenId}
          \`\`\`${JSON.stringify(await response.json())}\`\`\`
          `
        );

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

      console.log(`Refreshed token ${token.tokenId}`);
    } catch (e) {
      await telegramBotService.sendMessage(
        `Failed to refresh token for ${token.tokenId}
        \`\`\`${JSON.stringify(e)}\`\`\`
        `
      );
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

const launcherClient = '34a02cf8f4414e29b15921876da36f9a';
const launcherSecret = 'daafbccc737745039dffe53d94fc76cf';

export type LauncherAuthTokens = {
  access_token: string;
  expires_in: number;
  expires_at: string;
  token_type: string;
  refresh_token: string;
  refresh_expires: number;
  refresh_expires_at: string;
  account_id: string;
  client_id: string;
  internal_client: boolean;
  client_service: string;
  scope: string[];
  displayName: string;
  app: string;
  in_app_id: string;
  device_id: string;
  product_id: string;
  application_id: string;
};

// Refresh the admin user
app.patch('/refresh-admin', async (c) => {
  // Get the authorization header and compare it to 'JWT_SECRET' env variable
  const authorization = c.req.header('Authorization');

  if (!authorization) {
    console.error('Missing authorization header');
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  if (authorization.startsWith('Bearer ')) {
    const token = authorization.replace('Bearer ', '');

    if (token !== process.env.JWT_SECRET) {
      console.error('Invalid JWT_SECRET token');
      return c.json({ error: 'Invalid JWT_SECRET token' }, 401);
    }
  } else {
    console.error('Invalid authorization header');
    return c.json({ error: 'Invalid authorization header' }, 401);
  }

  const user = await db.db.collection('launcher').findOne<LauncherAuthTokens>({
    account_id: process.env.ADMIN_ACCOUNT_ID,
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Refresh the user tokens
  const { refresh_token, expires_at } = user;

  // If the token is not expired (within 10 minutes), just continue
  if (new Date(expires_at) > new Date(new Date().getTime() + 10 * 60 * 1000)) {
    return c.json({ message: 'Token is not expired' }, 200);
  }

  const url = new URL(
    'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token'
  );

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${launcherClient}:${launcherSecret}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
    }),
  });

  if (!response.ok) {
    console.error('Failed to refresh admin user tokens', await response.json());
    return c.json({ error: 'Failed to refresh admin user tokens' }, 401);
  }

  const responseData = (await response.json()) as LauncherAuthTokens;

  await db.db.collection('launcher').updateOne(
    {
      account_id: process.env.ADMIN_ACCOUNT_ID,
    },
    {
      $set: {
        access_token: responseData.access_token,
        refresh_token: responseData.refresh_token,
        expires_at: new Date(responseData.expires_at),
        refresh_expires_at: new Date(responseData.refresh_expires_at),
      },
    }
  );

  return c.json(
    {
      status: 'ok',
    },
    200
  );
});

app.post('/v2/persist', async (c) => {
  // Get the jwt token from the authorization header
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

  const certificate = process.env.JWT_PUBLIC_KEY;

  if (!certificate) {
    console.error('Missing JWT_PUBLIC_KEY env variable');
    return c.json({ error: 'Missing JWT_PUBLIC_KEY env variable' }, 401);
  }

  try {
    const egdataJWT = jwt.verify(token, readFileSync(certificate, 'utf-8'), {
      algorithms: ['RS256'],
    }) as {
      access_token: string;
      refresh_token: string;
      expires_at: string;
      refresh_expires_at: string;
      jti: string | undefined;
    };

    if (!egdataJWT || !egdataJWT.access_token || !egdataJWT.jti) {
      console.error('Invalid JWT');
      return c.json({ error: 'Invalid JWT' }, 401);
    }

    // Inspect the token from "decoded.access_token" and save it to the database
    const decoded = jwt.decode(egdataJWT.access_token as string) as {
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

    if (!decoded || !decoded.sub || !decoded.iss) {
      console.error('Invalid JWT');
      return c.json({ error: 'Invalid JWT' }, 401);
    }

    // Save the JWT to the database (same logic as "persist" endpoint)
    await db.db.collection('tokens').updateOne(
      {
        tokenId: egdataJWT.jti,
      },
      {
        $set: {
          accessToken: egdataJWT.access_token,
          refreshToken: egdataJWT.refresh_token,
          expiresAt: new Date(egdataJWT.expires_at),
          refreshExpiresAt: new Date(egdataJWT.refresh_expires_at),
          accountId: decoded.sub,
        },
      },
      {
        upsert: true,
      }
    );

    const existingEntry = await db.db.collection('epic').findOne({
      accountId: decoded.sub,
    });

    if (!existingEntry) {
      // Get user information from Epic Games and save the user to the `epic` collection
      const user = await getEpicAccount(egdataJWT.access_token, decoded.sub);

      await db.db.collection('epic').updateOne(
        {
          accountId: decoded.sub,
        },
        {
          $set: {
            ...user,
            creationDate: new Date(),
          },
        },
        {
          upsert: true,
        }
      );
    }

    return c.json(
      {
        id: egdataJWT.jti,
        status: 'ok',
      },
      200
    );
  } catch (err) {
    console.error('Error verifying JWT', err);
    return c.json({ error: 'Invalid JWT' }, 401);
  }
});

app.get('/v2/refresh', async (c) => {
  // Get the jwt token from the authorization header
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

  const certificate = process.env.JWT_PUBLIC_KEY;

  if (!certificate) {
    console.error('Missing JWT_PUBLIC_KEY env variable');
    return c.json({ error: 'Missing JWT_PUBLIC_KEY env variable' }, 401);
  }

  try {
    const egdataJWT = jwt.verify(token, readFileSync(certificate, 'utf-8'), {
      algorithms: ['RS256'],
    }) as {
      access_token: string;
      refresh_token: string;
      expires_at: string;
      refresh_expires_at: string;
      jti: string | undefined;
    };

    if (!egdataJWT || !egdataJWT.access_token || !egdataJWT.jti) {
      console.error('Invalid JWT');
      return c.json({ error: 'Invalid JWT' }, 401);
    }

    // Inspect the token from "decoded.access_token"
    const decoded = jwt.decode(egdataJWT.access_token as string) as {
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

    if (!decoded || !decoded.sub || !decoded.iss) {
      console.error('Invalid Epic JWT');
      return c.json({ error: 'Invalid Epic JWT' }, 401);
    }

    // Get the token from the database
    let dbtoken = await db.db
      .collection<{
        accessToken: string;
        refreshToken: string;
        expiresAt: Date;
        refreshExpiresAt: Date;
        accountId: string;
      }>('tokens')
      .findOne({
        tokenId: egdataJWT.jti,
      });

    if (!dbtoken) {
      console.error('Token not found');
      return c.json({ error: 'Token not found' }, 404);
    }

    // Check if the token is expired, if so, refresh it and return the new token
    if (dbtoken.expiresAt.getTime() < new Date().getTime()) {
      const url = new URL('https://api.epicgames.dev/epic/oauth/v2/token');

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.EPIC_CLIENT_ID}:${process.env.EPIC_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: dbtoken.refreshToken,
          scope: 'basic_profile',
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
          tokenId: egdataJWT.jti,
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
          upsert: false,
        }
      );

      dbtoken = await db.db
        .collection<{
          accessToken: string;
          refreshToken: string;
          expiresAt: Date;
          refreshExpiresAt: Date;
          accountId: string;
        }>('tokens')
        .findOne({
          tokenId: egdataJWT.jti,
        });
    }

    return c.json(
      {
        accessToken: dbtoken?.accessToken,
        refreshToken: dbtoken?.refreshToken,
        expiresAt: dbtoken?.expiresAt,
        refreshExpiresAt: dbtoken?.refreshExpiresAt,
      },
      200
    );
  } catch (err) {
    console.error('Error verifying JWT', err);
    return c.json({ error: 'Invalid JWT' }, 401);
  }
});

app.get('/logout', async (c) => {
  // Remove the cookie "EGDATA_AUTH" and redirect to "HTTPS://EGDATA.APP/"
  deleteCookie(c, 'EGDATA_AUTH', {
    secure: true,
    path: '/',
    domain: 'egdata.app',
  });
  return c.redirect('https://egdata.app/');
});

export default app;
