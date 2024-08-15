import { Hono } from 'hono';
import { jwtMiddleware } from '../middlewares/jwt';
import { decrypt } from '../utils/tokens';
import { EpicAuth } from '../db/schemas/epic-auth';

const app = new Hono();

app.use(jwtMiddleware);

app.get('/', async (c) => {
  const user = c.get('user') as { id: string };

  const id = decrypt(user.id);

  const epicInfo = await EpicAuth.findOne({ _id: id });

  if (!epicInfo) {
    return c.json({ error: 'User not found' }, 403);
  }

  const accountEpicUrl = new URL(
    'https://api.epicgames.dev/epic/id/v2/accounts'
  );

  accountEpicUrl.searchParams.append('accountId', epicInfo.account_id);

  const response = await fetch(accountEpicUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${epicInfo.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const data = await response.json();

  if ('error' in data) {
    console.error(`Failed to get account info`, data);
    return c.json(data);
  }

  return c.json({
    data,
  });
});

export default app;
