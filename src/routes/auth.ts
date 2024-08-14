import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { nanoid } from 'nanoid';
import { EpicAuth } from '../db/schemas/epic-auth';
import { encrypt } from '../utils/tokens';

/**
 * This route handles the authentication with Epic Games.
 */
const app = new Hono();

app.use(cors());

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

interface EpicAuthResponse {
  scope: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: Date;
  refresh_expires_in: number;
  refresh_expires_at: Date;
  account_id: string;
  client_id: string;
  application_id: string;
  acr: string;
  auth_time: Date;
}

interface EpicAuthResponseError {
  error: string;
}

app.get('/callback', async (c) => {
  const { code } = c.req.query();

  if (!code) {
    return c.json({
      error: 'Missing code',
    });
  }

  console.log(`Received code: ${code}`);

  const { EPIC_CLIENT_ID, EPIC_CLIENT_SECRET } = process.env;

  if (!EPIC_CLIENT_ID || !EPIC_CLIENT_SECRET) {
    return c.json({
      error: 'Missing environment variables',
    });
  }

  const url = new URL('https://api.epicgames.dev/epic/oauth/v2/token');

  const body = new URLSearchParams();
  body.append('grant_type', 'authorization_code');
  body.append('code', code);

  const auth = Buffer.from(`${EPIC_CLIENT_ID}:${EPIC_CLIENT_SECRET}`).toString(
    'base64'
  );

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = (await response.json()) as
    | EpicAuthResponse
    | EpicAuthResponseError;

  if ('error' in data) {
    console.error(`Failed to get access token`, data);
    return c.json(data);
  }

  console.log(`Received access token expires in: ${data.expires_in}`);

  const authEntryExists = await EpicAuth.exists({
    account_id: data.account_id,
  });

  if (authEntryExists) {
    await EpicAuth.updateOne({ account_id: data.account_id }, data);

    const tokens = await EpicAuth.findOne({ account_id: data.account_id });

    if (!tokens) {
      return c.json({
        error: 'Failed to update tokens',
      });
    }

    return c.json({
      id: encrypt(tokens._id),
    });
  } else {
    const id = nanoid();
    await EpicAuth.create({
      _id: id,
      ...data,
    });

    return c.json({
      id: encrypt(id),
    });
  }
});

app.get('/login', async (c) => {
  const { redirect } = c.req.query();

  const { EPIC_CLIENT_ID, EPIC_CLIENT_SECRET, EPIC_REDIRECT_URI } = process.env;

  if (
    !EPIC_CLIENT_ID ||
    !EPIC_CLIENT_SECRET ||
    (!EPIC_REDIRECT_URI && !redirect)
  ) {
    return c.json({
      error: 'Missing environment variables',
    });
  }

  const url = new URL('https://www.epicgames.com');
  url.pathname = '/id/authorize';
  url.searchParams.append('client_id', EPIC_CLIENT_ID);
  url.searchParams.append('scope', 'basic_profile');
  url.searchParams.append(
    'redirect_uri',
    (redirect || EPIC_REDIRECT_URI) as string
  );
  url.searchParams.append('response_type', 'code');

  return c.redirect(url.toString());
});

export default app;
