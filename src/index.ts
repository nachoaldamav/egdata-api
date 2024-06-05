import { Hono } from 'hono';
import { DB } from './db';
import { Offer } from './db/schemas/offer';
import { Item } from './db/schemas/item';

const app = new Hono();

const db = new DB();
db.connect()
  .then(() => {
    console.log('Connected to database');
  })
  .catch((err) => {
    console.error('Failed to connect to database', err);
    process.exit(1);
  });

app.get('/', (c) => {
  return c.json({
    app: 'egdata',
    version: '0.0.1-alpha',
  });
});

app.get('/offers', async (c) => {
  const offers = await Offer.find({}, undefined, {
    limit: 10,
    sort: {
      lastModifiedDate: -1,
    },
  });
  return c.json(offers);
});

app.get('/offers/:id', async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.find({
    $or: [{ _id: id }, { id: id }],
  });

  if (!offer || offer.length === 0) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  return c.json(offer[0]);
});

app.get('/items', async (c) => {
  const items = await Item.find({}, undefined, {
    limit: 10,
    sort: {
      lastModifiedDate: -1,
    },
  });
  return c.json(items);
});

app.get('/items/:id', async (c) => {
  const { id } = c.req.param();
  const item = await Item.find({
    $or: [{ _id: id }, { id: id }],
  });

  if (!item || item.length === 0) {
    c.status(404);
    return c.json({
      message: 'Item not found',
    });
  }

  return c.json(item[0]);
});

app.get('/latest-games', async (c) => {
  const start = new Date();
  const items = await Offer.find(
    {
      offerType: 'BASE_GAME',
    },
    undefined,
    {
      limit: 25,
      sort: {
        creationDate: -1,
      },
    }
  );
  const end = new Date();

  return c.json(
    items.map((i) => {
      return {
        id: i.id,
        namespace: i.namespace,
        title: i.title,
        description: i.description,
        lastModifiedDate: i.lastModifiedDate,
        effectiveDate: i.effectiveDate,
        creationDate: i.creationDate,
        keyImages: i.keyImages,
        productSlug: i.productSlug,
        urlSlug: i.urlSlug,
        url: i.url,
        tags: i.tags.map((t) => t.name),
        releaseDate: i.releaseDate,
        pcReleaseDate: i.pcReleaseDate,
        prePurchase: i.prePurchase,
        developerDisplayName: i.developerDisplayName,
        publisherDisplayName: i.publisherDisplayName,
        seller: i.seller?.name,
      };
    }),
    200,
    {
      'Cache-Control': 'public, max-age=60',
      'Server-Timing': `db;dur=${end.getTime() - start.getTime()}`,
    }
  );
});

export default {
  port: 4000,
  fetch: app.fetch,
};
