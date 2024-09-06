import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { cors } from 'hono/cors';
import * as jwt from 'jsonwebtoken';
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
      return next();
    }
  }
);

app.use(cors());

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

export default app;
