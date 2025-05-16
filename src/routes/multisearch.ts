import { Hono } from 'hono';
import { meiliSearchClient } from '../clients/meilisearch.js';
import { orderOffersObject } from '../utils/order-offers-object.js';
import { attributesToObject } from '../utils/attributes-to-object.js';

const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Hello, World!' });
});

app.get('/offers', async (c) => {
  let { query } = c.req.query();

  if (query?.includes('store.epicgames.com')) {
    const isUrl = URL.canParse(query);
    if (isUrl) {
      const url = new URL(query);
      const slug = url.pathname.split('/').pop();
      query = slug || query;
    }
  }

  const search = await meiliSearchClient.index('offers').search(query, {
    sort: ['offerTypeRank:asc', 'lastModifiedDate:desc'],
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
  const { query, type: entitlementType } = c.req.query();

  const search = await meiliSearchClient.index('items').search(query, {
    sort: ['lastModifiedDate:desc'],
    filter: entitlementType ? [`entitlementType = ${entitlementType}`] : [],
  });

  return c.json({
    ...search,
    hits: search.hits.map((hit) => {
      return {
        ...hit,
        customAttributes: hit.customAttributes
          ? attributesToObject(hit.customAttributes as any)
          : {},
      };
    }),
  });
});

app.get('/sellers', async (c) => {
  const { query } = c.req.query();

  const search = await meiliSearchClient.index('sellers').search(query);

  return c.json(search);
});

export default app;
