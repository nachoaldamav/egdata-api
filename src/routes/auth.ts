import { Hono } from 'hono';
import { cors } from 'hono/cors';
import GoogleAuth from '../db/schemas/google-auth';
import { encrypt, decrypt } from '../utils/tokens';
import { jwtMiddleware } from '../middlewares/jwt';
import { generateJWT } from '../utils/jwt';
import * as jwt from 'jsonwebtoken';

/**
 * This route handles the authentication with Google OAuth.
 */
const app = new Hono();

app.use(cors());

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token: string;
}

interface IdTokenPayload {
  iss: string;
  azp: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  at_hash: string;
  name: string;
  picture: string;
  given_name: string;
  family_name: string;
  iat: number;
  exp: number;
}

interface GoogleAuthResponseError {
  error: string;
  error_description?: string;
}

app.get('/callback', async (c) => {
  const { code } = c.req.query();

  if (!code) {
    return c.json({
      error: 'Missing code',
    });
  }

  console.log(`Received code: ${code}`);

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } =
    process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return c.json({
      error: 'Missing environment variables',
    });
  }

  const url = new URL('https://oauth2.googleapis.com/token');

  const body = new URLSearchParams();
  body.append('code', code);
  body.append('client_id', GOOGLE_CLIENT_ID);
  body.append('client_secret', GOOGLE_CLIENT_SECRET);
  body.append('redirect_uri', 'http://localhost:5173/auth/callback');
  body.append('grant_type', 'authorization_code');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = (await response.json()) as
    | GoogleAuthResponse
    | GoogleAuthResponseError;

  if ('error' in data) {
    console.error(`Failed to get access token`, data);
    return c.json(data);
  }

  console.log(`Received access token expires in: ${data.expires_in}`);

  const authEntryExists = await GoogleAuth.exists({
    id_token: data.id_token,
  });

  if (authEntryExists) {
    await GoogleAuth.updateOne(
      { id_token: data.id_token },
      {
        access_token: data.access_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000),
        scope: data.scope,
        token_type: data.token_type,
        refresh_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      }
    );

    const tokens = await GoogleAuth.findOne({ id_token: data.id_token });

    if (!tokens) {
      return c.json({
        error: 'Failed to update tokens',
      });
    }

    const jwtToken = generateJWT({ id: encrypt(tokens._id) });

    return c.json({
      jwt: jwtToken,
    });
  } else {
    const { nanoid } = await import('nanoid');
    const id = nanoid();
    await GoogleAuth.create({
      _id: id,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000),
      id_token: data.id_token,
      scope: data.scope,
      token_type: data.token_type,
      refresh_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });

    const jwtToken = generateJWT({ id: encrypt(id) });

    return c.json({
      jwt: jwtToken,
    });
  }
});

app.get('/login', async (c) => {
  const { redirect } = c.req.query();

  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = process.env;

  if (!GOOGLE_CLIENT_ID || (!GOOGLE_REDIRECT_URI && !redirect)) {
    return c.json({
      error: 'Missing environment variables',
    });
  }

  const url = new URL('https://accounts.google.com/o/oauth2/auth');
  url.searchParams.append('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.append(
    'redirect_uri',
    (redirect || GOOGLE_REDIRECT_URI) as string
  );
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', 'openid profile email');
  url.searchParams.append('access_type', 'offline');
  url.searchParams.append('prompt', 'consent');

  return c.redirect(url.toString());
});

app.get('/tokens/:id', jwtMiddleware, async (c) => {
  const { id } = c.req.param();
  const jwtId = c.get('user') as { id: string };

  if (id !== jwtId.id) {
    return c.json({
      error: 'Unauthorized',
    });
  }

  const _id = decrypt(id);

  const tokens = await GoogleAuth.findOne({ _id });

  if (!tokens) {
    return c.json({
      error: 'Invalid ID',
    });
  }

  return c.json(tokens);
});

app.patch('/refresh', async (c) => {
  const { token } = c.req.query();

  if (!token || token !== process.env.COOKIE_SECRET) {
    return c.json({
      error: 'Invalid token',
    });
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return c.json({
      error: 'Missing environment variables',
    });
  }

  const auth = Buffer.from(
    `${GOOGLE_CLIENT_ID}:${GOOGLE_CLIENT_SECRET}`
  ).toString('base64');

  // Get tokens that are about to expire
  const plusHalfHour = new Date(Date.now() + 30 * 60 * 1000);

  const authEntries = await GoogleAuth.find({
    expires_at: { $lt: plusHalfHour },
  });

  for (const entry of authEntries) {
    const url = new URL('https://oauth2.googleapis.com/token');

    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('refresh_token', entry.refresh_token);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await response.json();

    if (data.access_token && data.refresh_token) {
      await GoogleAuth.updateOne(
        { id_token: entry.id_token },
        {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: new Date(Date.now() + data.expires_in * 1000),
        }
      );
    } else {
      console.error(
        `Failed to refresh token for id_token ${entry.id_token}`,
        data
      );
    }
  }

  return c.json({
    message: 'Refreshed tokens',
  });
});

export default app;
