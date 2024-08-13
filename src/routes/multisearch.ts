import { Hono } from 'hono';
import { meiliSearchClient } from '../clients/meilisearch';
import { orderOffersObject } from '../utils/order-offers-object';

const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

app.get('/offers', async (c) => {
  const { query } = c.req.query();

  const search = await meiliSearchClient.index('offers').search(query, {
    sort: ['offerType:asc', 'lastModifiedDate:desc'],
  });

  return c.json({
    ...search,
    hits: search.hits.map((hit) => {
      return {
        ...orderOffersObject(hit as any),
        offerTypeRank: hit.offerTypeRank,
      };
    }),
  });
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
