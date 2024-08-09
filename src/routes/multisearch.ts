import { Hono } from 'hono';
import { meiliSearchClient } from '../clients/meilisearch';

const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

app.get('/offers', async (c) => {
  const { query } = c.req.query();

  const search = await meiliSearchClient.index('offers').search(query, {
    sort: ['lastModifiedDate:desc'],
  });

  return c.json(search);
});

app.get('/items', async (c) => {
  const { query } = c.req.query();

  const search = await meiliSearchClient.index('items').search(query, {
    sort: ['lastModifiedDate:desc'],
  });

  return c.json(search);
});

app.get('/sellers', async (c) => {
  const { query } = c.req.query();

  const search = await meiliSearchClient.index('sellers').search(query);

  return c.json(search);
});

export default app;
