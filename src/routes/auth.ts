import { Hono } from 'hono';

/**
 * This route handles the authentication with Epic Games.
 */
const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

app.get('/callback', async (c) => {
  const { code } = c.req.query();

  if (!code) {
    return c.json({
      error: 'Missing code',
    });
  }

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

  return c.json(await response.json());
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
