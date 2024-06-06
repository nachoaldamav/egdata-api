import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DB } from './db';
import { Offer } from './db/schemas/offer';
import { Item } from './db/schemas/item';
import { orderOffersObject } from './utils/order-offers-object';

const app = new Hono();
app.use(
  '/*',
  cors({
    origin: ['https://egdata.app', 'http://localhost:5173'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST'],
    credentials: true,
    maxAge: 86400,
  })
);

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
    endpoints: [
      '/offers',
      '/offers/:id',
      '/items',
      '/items/:id',
      '/latest-games',
    ],
  });
});

app.get('/offers', async (c) => {
  const start = new Date();
  const MAX_LIMIT = 50;
  const limit = Math.min(
    Number.parseInt(c.req.query('limit') || '10'),
    MAX_LIMIT
  );
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);

  const offers = await Offer.find({}, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      lastModifiedDate: -1,
    },
  })
    .hint({ lastModifiedDate: 1 })
    .allowDiskUse(true);

  return c.json(
    {
      elements: offers.map((o) => orderOffersObject(o)),
      page,
      limit,
      total: await Offer.countDocuments(),
    },
    200,
    {
      'Cache-Control': 'public, max-age=60',
      'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
    }
  );
});

app.get('/offers/:id', async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({
    $or: [{ _id: id }, { id: id }],
  });

  if (!offer) {
    c.status(404);
    return c.json({
      message: 'Offer not found',
    });
  }

  return c.json(orderOffersObject(offer));
});

app.get('/items', async (c) => {
  const MAX_LIMIT = 50;
  const limit = Math.min(
    Number.parseInt(c.req.query('limit') || '10'),
    MAX_LIMIT
  );
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);

  const items = await Item.find({}, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      lastModifiedDate: -1,
    },
  }).hint({ lastModifiedDate: 1 });

  return c.json({
    elements: items,
    page,
    limit,
    total: await Item.countDocuments(),
  });
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

// POST requests are for search
app.post('/offers', async (c) => {
  const body = await c.req.json().catch((err) => {
    c.status(400);
    return c.json({ message: 'Invalid request body' });
  });

  const query = body as SearchBody;
  let sort:
    | {
        [key: string]: 1 | -1 | { $meta: 'textScore' };
      }
    | undefined = undefined;

  let search: any = {};
  if (query.query) {
    search.$text = { $search: `"${query.query}"` };
    if (!sort) {
      sort = { score: { $meta: 'textScore' } };
    }
  }

  if (query.namespace) {
    search.namespace = query.namespace;
  }

  if (query.offerType) {
    search.offerType = query.offerType;
  }

  if (query.categories) {
    search.categories = { $in: query.categories };
  }

  if (query.sortBy) {
    if (!sort) sort = {};

    // If the sortBy is "releaseDate", we need to ignore the releases past the current date
    if (query.sortBy === 'releaseDate') {
      search.releaseDate = { $lte: new Date() };
    }

    sort[query.sortBy] = query.sortOrder === 'asc' ? 1 : -1; // Secondary sort by specified field
  }

  const limit = Math.min(query.limit || 10, 100);

  const offers = await Offer.find(search, undefined, {
    limit,
    skip: query.page ? query.page * (query.limit || 10) : 0,
    sort,
  });

  return c.json({
    elements: offers.map((o) => orderOffersObject(o)),
    total: await Offer.countDocuments(search),
    page: query.page || 1,
    limit,
  });
});

interface SearchBody {
  limit?: number;
  page?: number;
  query?: string;
  namespace?: string;
  offerType?: string;
  sortBy?:
    | 'lastModifiedDate'
    | 'creationDate'
    | 'effectiveDate'
    | 'releaseDate'
    | 'pcReleaseDate'
    | 'currentPrice';
  sortOrder?: 'asc' | 'desc';
  categories?: string[];
}

export default {
  port: 4000,
  fetch: app.fetch,
};
