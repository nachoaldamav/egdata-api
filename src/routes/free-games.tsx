import React from "react";
import { Hono } from "hono";
import { FreeGames } from "@egdata/core.schemas.free-games";
import { Offer } from "@egdata/core.schemas.offers";
import { PriceEngine } from "@egdata/core.schemas.price";
import satori from "satori";
import { orderOffersObject } from "../utils/order-offers-object.js";
import { regions } from "../utils/countries.js";
import { getCookie } from "hono/cookie";
import { Blob } from "node:buffer";
import client from "../clients/redis.js";
import { meiliSearchClient } from "../clients/meilisearch.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { getImage } from "../utils/get-image.js";
import { hash } from "node:crypto";
import { db } from "../db/index.js";

const app = new Hono();

app.get('/', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const freeGames = await FreeGames.find(
    {
      endDate: { $gte: new Date() },
    },
    null,
    {
      sort: {
        endDate: 1,
      },
    }
  );

  const result = await Promise.all(
    freeGames.map(async (game) => {
      const [offerData, priceData, historicalData] = await Promise.allSettled([
        Offer.findOne({
          id: game.id,
        }),
        PriceEngine.findOne({
          offerId: game.id,
          region: region,
        }),
        FreeGames.find({
          id: game.id,
        }),
      ]);

      const offer = offerData.status === 'fulfilled' ? offerData.value : null;
      const price = priceData.status === 'fulfilled' ? priceData.value : null;
      const historical =
        historicalData.status === 'fulfilled' ? historicalData.value : [];

      if (!offer) {
        return {
          giveaway: game,
        };
      }

      return {
        ...orderOffersObject(offer?.toObject()),
        giveaway: { ...game.toObject(), historical },
        price: price ?? null,
      };
    })
  );

  return c.json(result, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.get('/history', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');
  const limit = Math.min(Number.parseInt(c.req.query('limit') || '10'), 25);
  const page = Math.max(Number.parseInt(c.req.query('page') || '1'), 1);
  const skip = (page - 1) * limit;

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const cacheKey = `giveaways-history:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const freeGames = await FreeGames.find({}, null, {
    sort: {
      endDate: -1,
    },
    limit,
    skip,
  });

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: freeGames.map((g) => g.id) },
    }),
    PriceEngine.find({
      offerId: { $in: freeGames.map((g) => g.id) },
      region,
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : [];
  const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

  const result = await Promise.all(
    freeGames.map(async (game) => {
      const offer = offers.find((o) => o.id === game.id);
      const price = prices.find((p) => p.offerId === game.id);

      if (!offer) {
        return {
          giveaway: game,
        };
      }

      return {
        ...orderOffersObject(offer?.toObject()),
        price: price ?? null,
        giveaway: game,
      };
    })
  );

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.patch('/index', async (c) => {
  console.log('Refreshing MeiliSearch free games index');
  const index = meiliSearchClient.index('free-games');
  await index.deleteAllDocuments();

  const giveaways = await FreeGames.find({}, undefined, {
    sort: {
      endDate: -1,
    },
  });

  console.log(`Found ${giveaways.length} giveaways`);

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: giveaways.map((g) => g.id) },
    }),
    PriceEngine.find({
      offerId: { $in: giveaways.map((g) => g.id) },
      region: 'US',
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : [];
  const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

  const result = giveaways.map((g) => {
    const offer = offers.find((o) => o.id === g.id);
    const price = prices.find((p) => p.offerId === g.id);

    if (!offer) {
      return null;
    }

    return {
      ...orderOffersObject(offer),
      giveaway: {
        ...g.toObject(),
        startTimestamp: new Date(g.startDate).getTime(),
        endTimestamp: new Date(g.endDate).getTime(),
      },
      price: price ?? null,
      effectiveTimestamp: offer.effectiveDate
        ? new Date(offer.effectiveDate).getTime()
        : null,
      creationTimestamp: offer.creationDate
        ? new Date(offer.creationDate).getTime()
        : null,
      viewableTimestamp: offer.viewableDate
        ? new Date(offer.viewableDate).getTime()
        : null,
      pcReleaseTimestamp: offer.pcReleaseDate
        ? new Date(offer.pcReleaseDate).getTime()
        : null,
      _id: g._id,
    };
  });

  await index.addDocuments(
    result
      .filter((r) => r !== null)
      .map((o) => {
        return o;
      }),
    {
      primaryKey: '_id',
    }
  );

  return c.json({ message: 'ok' });
});

interface FreeGamesSearchQuery {
  title?: string;
  offerType?:
    | 'IN_GAME_PURCHASE'
    | 'BASE_GAME'
    | 'EXPERIENCE'
    | 'UNLOCKABLE'
    | 'ADD_ON'
    | 'Bundle'
    | 'CONSUMABLE'
    | 'WALLET'
    | 'OTHERS'
    | 'DEMO'
    | 'DLC'
    | 'VIRTUAL_CURRENCY'
    | 'BUNDLE'
    | 'DIGITAL_EXTRA'
    | 'EDITION';
  tags?: string[];
  sortBy?:
    | 'giveawayDate'
    | 'releaseDate'
    | 'lastModifiedDate'
    | 'effectiveDate'
    | 'creationDate'
    | 'viewableDate'
    | 'pcReleaseDate'
    | 'upcoming'
    | 'price'
    | 'giveaway.endDate'
    | 'price.price.discountPrice';
  sortDir?: 'asc' | 'desc';
  limit?: string;
  page?: string;
  categories?: string[];
  year?: string;
}

app.get('/search', async (c) => {
  const query = c.req.query() as FreeGamesSearchQuery;

  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const limit = Math.min(Number.parseInt(query.limit || '10'), 50);
  const page = Math.max(Number.parseInt(query.page || '1'), 1);
  const skip = (page - 1) * limit;
  let sort = query.sortBy || 'lastModifiedDate';
  const sortDir = query.sortDir || 'desc';

  const cacheKey = `free-games-search:${Buffer.from(
    JSON.stringify(query)
  ).toString('base64')}:${limit}:${page}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const start = new Date();

  const index = meiliSearchClient.index('free-games');

  const filters: Array<string> = [];

  if (query.offerType) {
    filters.push(`offerType = ${query.offerType}`);
  }

  if (query.tags) {
    filters.push(`tags.id in [${query.tags.map((t) => `'${t}'`).join(',')}]`);
  }

  if (query.categories) {
    filters.push(
      `categories in [${query.categories.map((t) => `'${t}'`).join(',')}]`
    );
  }

  if (query.sortBy) {
    if (query.sortBy === 'giveawayDate') {
      sort = 'giveaway.endDate';
    } else if (query.sortBy === 'price') {
      sort = 'price.price.discountPrice';
    }
  }

  sort += `:${sortDir}`;

  if (query.year) {
    // Meilisearch does not support dates, so we need to convert to milliseconds
    const startDate = new Date(`${query.year}-01-01`);
    const endDate = new Date(`${query.year}-12-31`);

    filters.push(`giveaway.startTimestamp >= ${startDate.getTime()}`);
    filters.push(`giveaway.endTimestamp <= ${endDate.getTime()}`);
  }

  const result = await index.search(query.title || '', {
    // Use empty string if title is undefined
    limit,
    offset: skip,
    filter: filters.length > 0 ? filters.join(' AND ') : undefined, // Apply filter only if not empty
    sort: [sort],
  });

  const prices = await PriceEngine.find({
    offerId: { $in: result.hits.map((h) => h.giveaway.id) },
    region,
  });

  const response = {
    elements: result.hits.map((h) => {
      const price = prices.find((p) => p.offerId === h.giveaway.id);
      return {
        ...h,
        price: price ?? null,
      };
    }),
    page,
    limit,
    total: result.estimatedTotalHits,
  };

  await client.set(cacheKey, JSON.stringify(response), {
    EX: 60,
  });

  return c.json(response, 200, {
    'Server-Timing': `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get('/stats', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const cacheKey = `giveaways-stats:${region}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const giveaways = await FreeGames.find({}, undefined, {
    sort: {
      endDate: -1,
    },
  });

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: giveaways.map((g) => g.id) },
    }),
    PriceEngine.find({
      offerId: { $in: giveaways.map((g) => g.id) },
      region,
    }),
  ]);

  const offers = offersData.status === 'fulfilled' ? offersData.value : [];
  const prices = pricesData.status === 'fulfilled' ? pricesData.value : [];

  const offerRepetitions: Record<string, number> = {};

  for (const offer of giveaways) {
    offerRepetitions[offer.id] = (offerRepetitions[offer.id] || 0) + 1;
  }

  const singleSellers: Record<string, number> = {};

  for (const offer of offers) {
    if (offer.seller) {
      singleSellers[offer.seller.id as string] =
        (singleSellers[offer.seller.id as string] || 0) + 1;
    }
  }

  const result: {
    totalValue: {
      currencyCode: string;
      originalPrice: number;
      discountPrice: number;
      discount: number;
      basePayoutPrice: number;
      basePayoutCurrencyCode: string;
      payoutCurrencyExchangeRate: number;
    };
    totalGiveaways: number;
    totalOffers: number;
    repeated: number;
    sellers: number;
  } = {
    totalValue: prices.reduce(
      (acc, p) => {
        return {
          currencyCode: acc.currencyCode,
          originalPrice: acc.originalPrice + p.price.originalPrice,
          discountPrice: acc.discountPrice + p.price.discountPrice,
          discount: acc.discount + p.price.discount,
          basePayoutPrice: acc.basePayoutPrice + p.price.basePayoutPrice,
          basePayoutCurrencyCode: acc.basePayoutCurrencyCode,
          payoutCurrencyExchangeRate: acc.payoutCurrencyExchangeRate,
        };
      },
      {
        currencyCode: prices[0].price.currencyCode,
        originalPrice: 0,
        discountPrice: 0,
        discount: 0,
        basePayoutPrice: 0,
        basePayoutCurrencyCode: prices[0].price.basePayoutCurrencyCode,
        payoutCurrencyExchangeRate: prices[0].price.payoutCurrencyExchangeRate,
      }
    ),
    totalOffers: offers.length,
    totalGiveaways: giveaways.length,
    // Sum all the repeated offers (1 is not repeated)
    repeated: Object.values(offerRepetitions).filter((count) => count > 1)
      .length,
    sellers: Object.keys(singleSellers).length,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 30,
  });

  return c.json(result, 200, {
    'Cache-Control': 'private, max-age=0',
  });
});

app.get('/og', async (c) => {
  const country = c.req.query('country');
  const cookieCountry = getCookie(c, 'EGDATA_COUNTRY');

  const selectedCountry = country ?? cookieCountry ?? 'US';

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: 'Country not found',
    });
  }

  const freeGames = await FreeGames.find(
    {
      endDate: { $gte: new Date() },
    },
    null,
    {
      sort: {
        endDate: 1,
      },
    }
  );

  const hash = createHash("sha256");
  hash.update(JSON.stringify(freeGames));

  // Check if the image already exists in the database
  const cachedImage = await db.db
    .collection("freebies-og")
    .findOne({
      hash: hash.digest("hex"),
    });

  if (cachedImage) {
    return c.json(
      {
        id: cachedImage.imageId,
      },
      200
    );
  }

  const games = await Promise.all(
    freeGames.map(async (game) => {
      const [offerData, priceData, historicalData] = await Promise.allSettled([
        Offer.findOne({
          id: game.id,
        }),
        PriceEngine.findOne({
          offerId: game.id,
          region: region,
        }),
        FreeGames.find({
          id: game.id,
        }),
      ]);

      const offer = offerData.status === 'fulfilled' ? offerData.value : null;
      const price = priceData.status === 'fulfilled' ? priceData.value : null;
      const historical =
        historicalData.status === 'fulfilled' ? historicalData.value : [];

      if (!offer) {
        return {
          giveaway: game,
        };
      }

      return {
        ...orderOffersObject(offer?.toObject()),
        giveaway: { ...game.toObject(), historical },
        price: price ?? null,
      };
    })
  );

  const svg = await satori(
    <div
      style={{
        width: '1300px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        background: '#001B3D',
        fontFamily: 'Inter, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Gradient Background */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            'linear-gradient(135deg, rgba(0, 27, 61, 1) 0%, rgba(0, 9, 19, 1) 100%)',
        }}
      />
      {/* Background Pattern */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            'linear-gradient(to bottom, rgba(0, 120, 242, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 120, 242, 0.05) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          opacity: 0.3,
        }}
      />
      {/* Content Container */}
      <div
        style={{
          padding: '60px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header */}
        <div
          style={{
            marginBottom: '40px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: '32px',
              color: 'rgba(255, 255, 255, 0.9)',
              marginBottom: '16px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            This Week on Epic Games
          </div>
          <div
            style={{
              fontSize: '72px',
              fontWeight: 800,
              color: '#FFFFFF',
              textShadow: '0 0 30px rgba(0, 120, 242, 0.3)',
            }}
          >
            FREE GAMES
          </div>
        </div>
        {/* Games Grid */}
        <div
          style={{
            display: 'flex',
            gap: '20px',
          }}
        >
          {games.map((game, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '24px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '200px',
                  background: 'rgba(0, 120, 242, 0.1)',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  color: '#0078F2',
                  fontWeight: 'bold',
                }}
              >
                <img
                  src={
                    getImage(game?.keyImages || [], [
                      'DieselGameBoxWide',
                      'OfferImageWide',
                      'Featured',
                      'DieselStoreFrontWide',
                      'VaultClosed',
                    ])?.url
                  }
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '8px',
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: 'white',
                  marginBottom: '8px',
                }}
              >
                {game.title}
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 1)',
                  display: 'flex',
                }}
              >
                {game.giveaway.startDate.toLocaleString('en-UK', {
                  month: 'short',
                  day: 'numeric',
                  year: undefined,
                })}{' '}
                -{' '}
                {game.giveaway.endDate.toLocaleString('en-UK', {
                  month: 'short',
                  day: 'numeric',
                  year: undefined,
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    {
      width: 1300,
      height: 630,
      fonts: [
        {
          name: 'Roboto',
          data: readFileSync(resolve('./src/static/Roboto-Light.ttf')),
          weight: 400,
          style: 'normal',
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [resolve('./src/static/Roboto-Light.ttf')],
      loadSystemFonts: false,
    },
    fitTo: {
      mode: 'width',
      value: 1400,
    },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const cfImagesUrl =
    'https://api.cloudflare.com/client/v4/accounts/7da0b3179a5b5ef4f1a2d1189f072d0b/images/v1';
  const accessToken = process.env.CF_IMAGES_KEY;

  const formData = new FormData();
  formData.set(
    'file',
    new Blob([pngBuffer], { type: 'image/png' }),
    // Generate a hash from the free games data
    `freebies-og/${hash.digest("hex")}.png`
  );

  const response = await fetch(cfImagesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    console.error('Failed to upload image', await response.json());
    return c.json({ error: 'Failed to upload image' }, 400);
  }

  const responseData = (await response.json()) as { result: { id: string } };

  // Save the image ID in the database
  await db.db.collection('freebies-og').updateOne(
    {
      id: responseData.result.id,
    },
    {
      $set: {
        imageId: responseData.result.id,
        hash: hash.digest("hex"),
      },
    },
    {
      upsert: true,
    }
  );

  return c.json(
    {
      id: responseData.result.id,
    },
    200
  );
});

export default app;
