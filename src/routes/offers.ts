import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { AchievementSet } from "@egdata/core.schemas.achievements";
import { Asset } from "@egdata/core.schemas.assets";
import { Bundles } from "@egdata/core.schemas.bundles";
import { Changelog } from "@egdata/core.schemas.changelog";
import { Collection, GamePosition } from "@egdata/core.schemas.collections";
import { FreeGames } from "@egdata/core.schemas.free-games";
import { Hltb } from "@egdata/core.schemas.hltb";
import { Item } from "@egdata/core.schemas.items";
import { Mappings } from "@egdata/core.schemas.mappings";
import { Media } from "@egdata/core.schemas.media";
import { Offer, type OfferType } from "@egdata/core.schemas.offers";
import {
  PriceEngine,
  PriceEngineHistorical,
  type PriceEngineType as PriceType,
} from "@egdata/core.schemas.price";
import { Ratings } from "@egdata/core.schemas.ratings";
import { Sandbox } from "@egdata/core.schemas.sandboxes";
import { OfferSubItems } from "@egdata/core.schemas.subitems";
import { TagModel, Tags } from "@egdata/core.schemas.tags";
import { Queue } from "bullmq";

import { db } from "../db/index.js";
import { type IReview, Review } from "../db/schemas/reviews.js";
import client, { ioredis } from "../clients/redis.js";
import { ageRatingsCountries } from "../utils/age-ratings.js";
import { attributesToObject } from "../utils/attributes-to-object.js";
import { regions } from "../utils/countries.js";
import { epic, epicInfo } from "./auth.js";
import { getGameFeatures } from "../utils/game-features.js";
import { getImage } from "../utils/get-image.js";
import { getProduct } from "../utils/get-product.js";
import { orderOffersObject } from "../utils/order-offers-object.js";
import { verifyGameOwnership } from "../utils/verify-game-ownership.js";
import consola from "consola";

type RegenOfferQueueType =
  | { slug: string }
  | { id: string; namespace?: string };

const regenOffersQueue = new Queue<RegenOfferQueueType>("regenOffersQueue", {
  connection: ioredis,
});

const app = new Hono();

// Add memory tracking middleware
app.use("*", async (c, next) => {
  const startMemory = process.memoryUsage();
  const start = new Date();

  await next();

  const endMemory = process.memoryUsage();
  const end = new Date();

  // Calculate memory differences
  const memoryDiff = {
    rss: endMemory.rss - startMemory.rss,
    heapTotal: endMemory.heapTotal - startMemory.heapTotal,
    heapUsed: endMemory.heapUsed - startMemory.heapUsed,
    external: endMemory.external - startMemory.external,
    arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers,
    responseTime: end.getTime() - start.getTime(),
  };

  consola.info({
    request: `[${c.req.method}] ${c.req.path}`,
    memory: {
      rss: `${(memoryDiff.rss / 1024 / 1024).toFixed(2)}MB`,
      heapTotal: `${(memoryDiff.heapTotal / 1024 / 1024).toFixed(2)}MB`,
      heapUsed: `${(memoryDiff.heapUsed / 1024 / 1024).toFixed(2)}MB`,
      external: `${(memoryDiff.external / 1024 / 1024).toFixed(2)}MB`,
      arrayBuffers: `${(memoryDiff.arrayBuffers / 1024 / 1024).toFixed(2)}MB`,
    },
    performance: {
      responseTime: `${(memoryDiff.responseTime / 1000).toFixed(2)}s`,
    },
  });
});

app.get("/", async (c) => {
  const start = new Date();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const MAX_LIMIT = 50;
  const limit = Math.min(
    Number.parseInt(c.req.query("limit") || "10"),
    MAX_LIMIT
  );
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);

  const cacheKey = `offers:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offers = await Offer.find({}, undefined, {
    limit,
    skip: (page - 1) * limit,
    sort: {
      lastModifiedDate: -1,
    },
  });

  const prices = await PriceEngine.find({
    offerId: { $in: offers.map((o) => o.id) },
    region,
  });

  const result = {
    elements: offers.map((o) => {
      const price = prices.find((p) => p.offerId === o.id);
      return {
        ...orderOffersObject(o),
        price: price ?? null,
      };
    }),
    page,
    limit,
    total: await Offer.countDocuments(),
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 60);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get("/events", async (c) => {
  const events = await Tags.find({
    groupName: "event",
    status: "ACTIVE",
  });

  return c.json(events, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/events/:id", async (c) => {
  // Same as the /promotions/:id endpoint
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 50);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const cacheKey = `event:${id}:${region}:${page}:${limit}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const event = await Tags.findOne({
    id,
    groupName: "event",
  });

  if (!event) {
    c.status(404);
    return c.json({
      message: "Event not found",
    });
  }

  const offers = await Offer.aggregate([
    { $match: { tags: { $elemMatch: { id } } } },
    {
      $lookup: {
        from: "pricev2",
        let: { offerId: "$id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$offerId", "$$offerId"] },
                  { $eq: ["$region", region] },
                ],
              },
            },
          },
          {
            $sort: { updatedAt: -1 },
          },
          {
            $limit: 1,
          },
        ],
        as: "price",
      },
    },
    {
      $unwind: {
        path: "$price",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: { "price.price.discount": -1 },
    },
    {
      $skip: skip,
    },
    {
      $limit: limit,
    },
    {
      $project: {
        _id: 0,
        id: 1,
        namespace: 1,
        title: 1,
        seller: 1,
        developerDisplayName: 1,
        publisherDisplayName: 1,
        keyImages: 1,
        price: 1,
      },
    },
  ]);

  const result = {
    elements: offers,
    title: event.name ?? "",
    limit,
    start: skip,
    page,
    count: await Offer.countDocuments({
      tags: { $elemMatch: { id } },
    }),
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/upcoming", async (c) => {
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const limit = Math.min(Number.parseInt(c.req.query("limit") || "15"), 50);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;

  const start = new Date();

  const cacheKey = `upcoming:${region}:${page}:${limit}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offers = await Offer.aggregate([
    {
      $match: {
        releaseDate: {
          $gt: new Date(),
          $ne: null,
          $lt: new Date("2099-01-01"),
        },
        // Only show "BASE_GAME" and "DLC" offers
        offerType: {
          $in: ["BASE_GAME", "DLC"],
        },
      },
    },
    {
      $lookup: {
        from: "pricev2",
        let: { offerId: "$id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$offerId", "$$offerId"] },
                  { $eq: ["$region", region] },
                ],
              },
            },
          },
          {
            $limit: 1,
          },
        ],
        as: "price",
      },
    },
    {
      $unwind: {
        path: "$price",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $sort: { releaseDate: 1 },
    },
    {
      $skip: skip,
    },
    {
      $limit: limit,
    },
  ]);

  const result = {
    elements: offers.map((o) => {
      return {
        ...orderOffersObject(o),
        price: o.price ?? null,
      };
    }),
    limit,
    start: skip,
    page,
    count: await Offer.countDocuments({
      effectiveDate: { $gt: new Date() },
    }),
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 360);

  return c.json(result, 200, {
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/genres", async (c) => {
  const genres = await Tags.find({
    groupName: "genre",
    status: "ACTIVE",
  });

  const result = await Promise.all(
    genres.map(async (genre) => {
      const offers = await Offer.find(
        {
          tags: { $elemMatch: { id: genre.id } },
          offerType: "BASE_GAME",
          releaseDate: { $lte: new Date() },
        },
        undefined,
        {
          limit: 3,
          sort: {
            releaseDate: -1,
          },
        }
      );

      return {
        genre,
        offers: offers.map((o) => {
          return {
            id: o.id,
            title: o.title,
            image: getImage(o.keyImages, [
              "OfferImageTall",
              "Thumbnail",
              "DieselGameBoxTall",
              "DieselStoreFrontTall",
            ]),
          };
        }),
      };
    })
  );

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/top-wishlisted", async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 10);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;
  const start = new Date();
  const cacheKey = `top-wishlisted:${page}:${limit}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const result = await GamePosition.find({
    collectionId: "top-wishlisted",
    position: { $gt: 0 },
  })
    .sort({ position: 1 })
    .limit(limit)
    .skip(skip);

  const offers = await Offer.find({
    id: { $in: result.map((o) => o.offerId) },
  });

  if (result.length > 0) {
    const response = {
      elements: offers
        .map((o: OfferType) => {
          return {
            ...orderOffersObject(o),
            position: result.find((r) => r.offerId === o.id)?.position,
          };
        })
        .sort((a, b) => a.position - b.position),
      page,
      limit,
      total: await GamePosition.countDocuments({
        position: { $gt: 0 },
      }),
    };
    await client.set(cacheKey, JSON.stringify(response), "EX", 3600);
    return c.json(response, 200, {
      "Cache-Control": "public, max-age=60",
      "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
    });
  }

  return c.json({ elements: [], page, limit, total: 0 }, 200, {
    "Cache-Control": "public, max-age=60",
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get("/top-sellers", async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 10);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;
  const start = new Date();
  const cacheKey = `top-sellers:${page}:${limit}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const result = await GamePosition.find({
    collectionId: "top-sellers",
    position: { $gt: 0 },
  })
    .sort({ position: 1 })
    .limit(limit)
    .skip(skip);

  const offers = await Offer.find({
    id: { $in: result.map((o) => o.offerId) },
  });

  if (result.length > 0) {
    const response = {
      elements: offers
        .map((o: OfferType) => {
          return {
            ...orderOffersObject(o),
            position: result.find((r) => r.offerId === o.id)?.position,
          };
        })
        .sort((a, b) => a.position - b.position),
      page,
      limit,
      total: await GamePosition.countDocuments({
        collectionId: "top-sellers",
        position: { $gt: 0 },
      }),
    };
    await client.set(cacheKey, JSON.stringify(response), "EX", 3600);
    return c.json(response, 200, {
      "Cache-Control": "public, max-age=60",
      "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
    });
  }

  return c.json({ elements: [], page, limit, total: 0 }, 200, {
    "Cache-Control": "public, max-age=60",
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get("/featured-discounts", async (c) => {
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");
  const selectedCountry = country ?? cookieCountry ?? "US";
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );
  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `featured-discounts:${region}:v0.3`;
  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  // First get the featured offers IDs with their positions
  const featuredOffers = await GamePosition.find({
    position: { $gt: 0 },
  })
    .sort({ position: 1 })
    .limit(200) // Limit early to reduce data processing
    .lean();

  if (!featuredOffers.length) {
    return c.json([], 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offerIds = featuredOffers.map((o) => o.offerId);

  // Get offers and prices in parallel
  const [offers, prices] = await Promise.all([
    Offer.find({
      id: { $in: offerIds },
      offerType: { $in: ["BASE_GAME", "DLC"] },
    }).lean(),
    PriceEngine.find({
      offerId: { $in: offerIds },
      region,
      "price.discount": { $gt: 0 },
    })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  // Create a map of prices for quick lookup
  const priceMap = new Map(prices.map((p) => [p.offerId, p]));

  // Create a map of positions for quick lookup
  const positionMap = new Map(
    featuredOffers.map((p) => [p.offerId, p.position])
  );

  // Combine the data and sort by position
  const result = offers
    .map((offer) => {
      const price = priceMap.get(offer.id);
      const position = positionMap.get(offer.id);

      if (!price || position === undefined) return null;

      return {
        ...offer,
        price,
        position,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .slice(0, 20);

  // Save the result in cache
  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/latest-achievements", async (c) => {
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");
  const selectedCountry = country ?? cookieCountry ?? "US";
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );
  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }
  const cacheKey = `latest-achievements:${region}:v0.1`;
  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }
  const limit = 15; // Number of games to fetch per page
  let skip = 0;
  let result: any[] = [];
  while (result.length < 20) {
    const offers = await Offer.find({
      offerType: { $in: ["BASE_GAME"] },
      "tags.id": "19847",
      effectiveDate: { $lte: new Date() },
    })
      .sort({ effectiveDate: -1 })
      .skip(skip)
      .limit(limit);
    const [achievementsData, pricesData] = await Promise.allSettled([
      AchievementSet.find({
        sandboxId: { $in: offers.map((o) => o.namespace) },
        isBase: true,
      }),
      PriceEngine.find({
        offerId: { $in: offers.map((o) => o.id) },
        region,
      }),
    ]);
    const achievements =
      achievementsData.status === "fulfilled" ? achievementsData.value : [];
    const prices = pricesData.status === "fulfilled" ? pricesData.value : [];
    const pageResults = offers
      .map((o) => {
        const price = prices.find((p) => p.offerId === o.id);
        const achievement = achievements.find(
          (a) => a.sandboxId === o.namespace
        );
        return {
          ...orderOffersObject(o),
          achievements: achievement,
          price: price ?? null,
        };
      })
      .filter((o) => o.achievements);
    result = result.concat(pageResults);
    skip += limit;
    if (offers.length < limit) {
      // Reached the end of the data
      break;
    }
  }
  result = result.slice(0, 20);
  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);
  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/latest-released", async (c) => {
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");
  const selectedCountry = country ?? cookieCountry ?? "US";
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );
  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 50);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;
  const cacheKey = `latest-released:${region}`;
  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }
  const offers = await Offer.find(
    {
      effectiveDate: {
        $lte: new Date(),
      },
      offerType: {
        $in: ["BASE_GAME", "DLC"],
      },
      releaseDate: {
        $ne: null,
        $lte: new Date(),
      },
    },
    undefined,
    {
      sort: {
        releaseDate: -1,
      },
      limit,
      skip,
    }
  );
  const prices = await PriceEngine.find({
    offerId: { $in: offers.map((o) => o.id) },
    region,
  });
  const result = {
    elements: offers.map((o) => {
      const price = prices.find((p) => p.offerId === o.id);
      return {
        ...orderOffersObject(o),
        price: price ?? null,
      };
    }),
    limit,
    start: skip,
    page,
    count: await Offer.countDocuments({
      releaseDate: { $ne: null },
      offerType: { $in: ["BASE_GAME"] },
    }),
  };
  await client.set(cacheKey, JSON.stringify(result), "EX", 60);
  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.put("/regen/:slug", async (c) => {
  const { slug } = c.req.param();

  await regenOffersQueue.add(`regenOffer-${slug}`, { slug });

  return c.json({ message: "Offer regen requested" }, 200);
});

app.put("/regen-by-id/:id", async (c) => {
  const { id } = c.req.param();

  await regenOffersQueue.add(`regenOffer-${id}`, { id });

  return c.json({ message: "Offer regen requested" }, 200);
});

app.post("/bulk-regen", async (c) => {
  const { offers } = await c.req.json<{ offers: string[] }>();

  await regenOffersQueue.addBulk(
    offers.map((o) => ({
      name: `regenOffer-${o}`,
      data: { id: o },
    }))
  );

  return c.json({ message: "Offer regen requested" }, 200);
});

app.post("/slugs", async (c) => {
  const { slugs } = await c.req.json<{ slugs: string[] }>();

  if (!slugs || !Array.isArray(slugs) || slugs.length === 0) {
    c.status(400);
    return c.json({
      message:
        "Missing or invalid slugs parameter. Expecting an array of strings.",
    });
  }

  // Create an expanded list of slugs including their /home variants
  const expandedSlugs = slugs.flatMap((slug) => [slug, `${slug}/home`]);

  const offers = await Offer.find({
    $and: [
      {
        $or: [
          { productSlug: { $in: expandedSlugs } },
          { urlSlug: { $in: expandedSlugs } },
          { "offerMappings.pageSlug": { $in: expandedSlugs } },
          {
            customAttributes: {
              $elemMatch: {
                key: "com.epicgames.app.productSlug",
                value: { $in: expandedSlugs },
              },
            },
          },
          {
            customAttributes: {
              $elemMatch: { key: "slug", value: { $in: expandedSlugs } }, // Keep generic slug check as well
            },
          },
        ],
      },
      { prePurchase: { $ne: true } }, // Exclude pre-purchase offers
    ],
  }).select(
    "id productSlug urlSlug offerMappings customAttributes prePurchase namespace"
  );

  const result = slugs.map((originalSlug) => {
    const offer = offers.find((o) => {
      const checkSlug = (s: string | undefined) =>
        s === originalSlug || s === `${originalSlug}/home`;

      if (checkSlug(o.productSlug)) return true;
      if (checkSlug(o.urlSlug)) return true;
      if (o.offerMappings?.some((m: any) => checkSlug(m.pageSlug))) return true;
      if (
        o.customAttributes?.some(
          (attr: any) =>
            attr.key === "com.epicgames.app.productSlug" &&
            checkSlug(attr.value)
        )
      )
        return true;
      if (
        o.customAttributes?.some(
          (attr: any) => attr.key === "slug" && checkSlug(attr.value)
        )
      )
        return true;
      return false;
    });
    return {
      slug: originalSlug,
      id: offer ? offer.id : null,
      namespace: offer ? offer.namespace : null,
    };
  });

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.post("/exists", async (c) => {
  const { offers } = await c.req.json<{ offers: string[] }>();
  // Return 2 arrays, the offers IDs that already exist and the ones that don't
  const existingOffers = await Offer.find(
    { id: { $in: offers } },
    { id: 1, _id: 0 }
  );
  const existingIds = existingOffers.map((o) => o.id);
  const nonExistingOffers = offers.filter(
    (offer) => !existingIds.includes(offer)
  );
  return c.json({ existingOffers: existingIds, nonExistingOffers }, 200);
});

app.get("/:id", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const start = new Date();

  const cacheKey = `offer:${id}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  // Define the queries
  const offerQuery = Offer.findOne({ id }).lean();

  // Execute both queries in parallel
  const [offer] = await Promise.all([offerQuery]);

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found or Price not found",
    });
  }

  // Combine the offer and price data
  const result = {
    ...offer,
    customAttributes: attributesToObject(offer.customAttributes as any),
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 60);

  return c.json(result, 200, {
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get("/:id/price-history", async (c) => {
  const { id } = c.req.param();
  const since = c.req.query("since");

  const country = c.req.query("country");
  const usrRegion = c.req.query("region");

  const region =
    usrRegion ||
    Object.keys(regions).find((r) => regions[r].countries.includes(country));

  if (region) {
    const cacheKey = `price-history:${id}:${region}:${since ?? "unlimited"
      }:v0.1`;
    const cached = await client.get(cacheKey);

    if (cached) {
      return c.json(JSON.parse(cached), 200, {
        "Cache-Control": "public, max-age=60",
      });
    }

    // Show just the prices for the selected region
    const prices = await PriceEngineHistorical.find({
      offerId: id,
      region,
      ...(since && {
        updatedAt: { $gte: new Date(since) },
      }),
    }).sort({ date: -1 });

    if (!prices) {
      c.status(200);
      return c.json({});
    }

    await client.set(cacheKey, JSON.stringify(prices), "EX", 3600);

    return c.json(prices, 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const cacheKey = `price-history:${id}:all:${since ?? "unlimited"}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const prices = await PriceEngineHistorical.find({
    offerId: id,
    region: { $in: Object.keys(regions) },
    ...(since && {
      updatedAt: { $gte: new Date(since) },
    }),
  }).sort({ date: -1 });

  // Structure the data, Record<string, PriceHistoryType[]>
  const pricesByRegion = prices.reduce((acc, price) => {
    if (!price?.region) return acc;

    if (!acc[price.region]) {
      acc[price.region] = [];
    }

    acc[price.region].push(price);

    return acc;
  }, {} as Record<string, PriceType[]>);

  if (!pricesByRegion || Object.keys(pricesByRegion).length === 0) {
    c.status(200);
    return c.json({});
  }

  await client.set(cacheKey, JSON.stringify(pricesByRegion), "EX", 3600);

  return c.json(pricesByRegion, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/features", async (c) => {
  const { id } = c.req.param();

  // We need to get the offers and items for that offer
  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...offer.items.map((i) => i.id),
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  const customAttributes = items.reduce((acc, item) => {
    return Object.assign(acc, attributesToObject(item.customAttributes as any));
  }, attributesToObject([]));

  // Get the game features
  const tagsObject = offer.tags.reduce((acc, tag) => {
    acc[tag.id] = tag;
    return acc;
  }, {});

  const gameFeatures = getGameFeatures({
    attributes: customAttributes,
    tags: tagsObject,
  });

  return c.json(gameFeatures);
});

app.get("/:id/assets", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `assets:offer:${id}:v0.2`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({
    id: id,
  });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find(
    {
      $or: [
        {
          id: {
            $in: [
              ...offer.items.map((i) => i.id),
              ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
            ],
          },
        },
        { linkedOffers: id },
      ],
    },
    {
      id: 1,
    }
  );

  const assets = await Asset.find({
    itemId: { $in: items.map((i) => i.id) },
  });

  const result = assets.map((a) => a.toObject());

  await client.set(cacheKey, JSON.stringify(assets), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/items", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `items:offer:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({
    id: id,
  });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const itemsSpecified = offer.items.map((item) => item.id);

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  // Or it's an item specified by the offer, or it's linked by the item
  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...itemsSpecified,
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  return c.json(items, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/price", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `price:${id}:${region}:v0.1`;

  console.log(`Requesting ${cacheKey}`);

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const price = await PriceEngine.findOne({
    offerId: id,
    region,
  });

  if (!price) {
    c.status(404);
    return c.json({
      message: "Price not found",
    });
  }

  await client.set(cacheKey, JSON.stringify(price), "EX", 3600);

  return c.json(price, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/regional-price", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");

  if (country) {
    const region = Object.keys(regions).find((r) =>
      regions[r].countries.includes(country)
    );

    if (!region) {
      c.status(404);
      return c.json({
        message: "Country not found",
      });
    }

    const cacheKey = `regional-price:${id}:${region}:v0.2`;
    const cached = await client.get(cacheKey);

    if (cached) {
      return c.json(JSON.parse(cached), 200, {
        "Cache-Control": "public, max-age=60",
      });
    }

    const offer = await Offer.findOne({ id }).lean();

    const releaseDate = offer?.releaseDate ?? (offer?.effectiveDate as Date);
    const currentDate = new Date();

    let priceQuery = { offerId: id, region } as Record<string, unknown>;

    if (releaseDate && releaseDate <= currentDate) {
      priceQuery.updatedAt = { $gte: releaseDate, $lte: currentDate };
    }

    let price = await PriceEngineHistorical.find(priceQuery, undefined, {
      sort: {
        updatedAt: -1,
      },
    });

    if (!price || price.length === 0) {
      // Try to find the price in the historical data
      price = await PriceEngineHistorical.find(
        {
          offerId: id,
          region,
        },
        undefined,
        {
          sort: {
            updatedAt: -1,
          },
        }
      );

      if (price.length === 0) {
        c.status(404);
        return c.json({
          message: "Price not found",
        });
      }
    }

    const result = {
      currentPrice: price[0],
      maxPrice: Math.max(...price.map((p) => p.price.discountPrice ?? 0)),
      minPrice: Math.min(...price.map((p) => p.price.discountPrice ?? 0)),
    };

    await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

    return c.json(result, 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const cacheKey = `regional-price:${id}:all`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id }).lean();

  const releaseDate = offer?.releaseDate ?? (offer?.effectiveDate as Date);
  const currentDate = new Date();

  let priceQuery = { offerId: id } as any;

  if (releaseDate && releaseDate <= currentDate) {
    priceQuery.updatedAt = { $gte: releaseDate };
  }

  let prices = await PriceEngineHistorical.find(priceQuery, undefined, {
    sort: {
      updatedAt: -1,
    },
  });

  if (prices.length === 0) {
    console.log("prices.length === 0");
    prices = await PriceEngineHistorical.find(
      {
        offerId: id,
      },
      undefined,
      {
        sort: {
          updatedAt: -1,
        },
      }
    );
  }

  const regionsKeys = Object.keys(regions);

  const result = regionsKeys.reduce(
    (acc, r) => {
      const regionPrices = prices.filter((p) => p?.region === r);

      if (!regionPrices.length) {
        return acc;
      }

      const lastPrice = regionPrices.sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
      )[0];

      const allPrices = regionPrices.map((p) => p.price.discountPrice ?? 0);

      const maxPrice = Math.max(...allPrices);
      const minPrice = Math.min(...allPrices);

      acc[r] = {
        currentPrice: lastPrice,
        maxPrice,
        minPrice,
      };

      return acc;
    },
    {} as Record<
      string,
      {
        currentPrice: PriceType;
        maxPrice: number;
        minPrice: number;
      }
    >
  );

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/changelog", async (c) => {
  const { id } = c.req.param();

  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 50);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;
  const query = c.req.query("query");
  const changeType = c.req.query("type");
  const field = c.req.query("field");

  const cacheKey = `changelog:${id}:${page}:${limit}:${query}:${changeType}:${field}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({
    id,
  });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...offer.items.map((i) => i.id),
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  const assets = await Asset.find({
    itemId: { $in: items.map((i) => i.id) },
  });

  const allIds = [
    id,
    ...items.map((i) => i.id).concat(assets.map((a) => a.artifactId)),
  ];

  const matchQuery: Record<string, unknown> = {
    "metadata.contextId": { $in: allIds },
  };

  if (query) {
    matchQuery.$text = { $search: query };
  }

  if (changeType) {
    matchQuery["metadata.changes.changeType"] = changeType;
  }

  if (field) {
    matchQuery["metadata.changes.field"] = field;
  }

  // Get total count first
  const totalCount = await db.db
    .collection("changelogs_v2")
    .countDocuments(matchQuery);

  const totalPages = Math.ceil(totalCount / limit);

  // Use aggregation pipeline for better performance
  const changelog = await db.db
    .collection("changelogs_v2")
    .aggregate([
      {
        $match: matchQuery,
      },
      {
        $sort: { timestamp: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
      {
        $lookup: {
          from: "offers",
          let: { contextId: "$metadata.contextId" },
          pipeline: [{ $match: { $expr: { $eq: ["$id", "$$contextId"] } } }],
          as: "offerDoc",
        },
      },
      {
        $lookup: {
          from: "items",
          let: { contextId: "$metadata.contextId" },
          pipeline: [{ $match: { $expr: { $eq: ["$id", "$$contextId"] } } }],
          as: "itemDoc",
        },
      },
      {
        $lookup: {
          from: "assets",
          let: { contextId: "$metadata.contextId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$artifactId", "$$contextId"] } } },
          ],
          as: "assetDoc",
        },
      },
      {
        $addFields: {
          document: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$metadata.contextType", "offer"] },
                  then: { $arrayElemAt: ["$offerDoc", 0] },
                },
                {
                  case: { $eq: ["$metadata.contextType", "item"] },
                  then: { $arrayElemAt: ["$itemDoc", 0] },
                },
                {
                  case: { $eq: ["$metadata.contextType", "asset"] },
                  then: { $arrayElemAt: ["$assetDoc", 0] },
                },
              ],
              default: null,
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          metadata: 1,
          timestamp: 1,
          document: 1,
        },
      },
    ])
    .toArray();

  const response = {
    elements: changelog,
    page,
    limit,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };

  // Cache the results
  await client.set(cacheKey, JSON.stringify(response), "EX", 60);

  return c.json(response, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

/**
 * Retrieve the stats for the offer changelog in a given timeframe
 * - Daily changes number
 * - Weekday changes number
 * - Change-types number
 * - Change field number
 */
app.get("/:id/changelog/stats", async (c) => {
  const { id } = c.req.param();
  const { from, to } = c.req.query();

  // Check if from and to are parseable as Dates
  if (!from || !to) {
    return c.json({
      message: "Missing from or to query parameter",
    });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return c.json({
      message: "Invalid from or to query parameter",
    });
  }

  const cacheKey = `changelog-stats:${id}:${fromDate.toISOString()}:${toDate.toISOString()}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const changes = await Changelog.find(
    {
      "metadata.contextId": id,
      timestamp: {
        $gte: fromDate,
        $lte: toDate,
      },
    },
    undefined,
    {
      sort: {
        timestamp: -1,
      },
    }
  );

  // Corrected: Get the full date string (YYYY-MM-DD)
  const dailyChanges = changes.reduce((acc, change) => {
    const date = change.timestamp.toISOString().split("T")[0]; // Get YYYY-MM-DD
    if (!acc[date]) {
      acc[date] = 0;
    }
    acc[date]++;
    return acc;
  }, {} as Record<string, number>);

  const weekdayChanges = changes.reduce((acc, change) => {
    const day = change.timestamp.getDay();
    if (!acc[day]) {
      acc[day] = 0;
    }
    acc[day]++;
    return acc;
  }, {} as Record<number, number>);

  // Corrected: Use change.metadata.changes[].changeType
  const changeTypes = changes.reduce((acc, change) => {
    change.metadata.changes.forEach((item) => {
      if (!acc[item.changeType]) {
        acc[item.changeType] = 0;
      }
      acc[item.changeType]++;
    });

    return acc;
  }, {} as Record<string, number>);

  // Corrected: Use change.metadata.changes[].field
  const changeFields = changes.reduce((acc, change) => {
    change.metadata.changes.forEach((item) => {
      if (!acc[item.field]) {
        acc[item.field] = 0;
      }
      acc[item.field]++;
    });
    return acc;
  }, {} as Record<string, number>);

  await client.set(cacheKey, JSON.stringify(changeFields), "EX", 3600);

  return c.json({
    dailyChanges,
    weekdayChanges,
    changeTypes,
    changeFields,
  });
});

app.get("/:id/achievements", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const offer = await Offer.findOne(
    { id },
    {
      namespace: 1,
      offerType: 1,
    }
  );

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const cacheKey = `achievements:offer:${id}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const achievements = await AchievementSet.find({
    sandboxId: offer.namespace,
    isBase: offer.offerType === "BASE_GAME",
  });

  if (achievements.length === 0) {
    c.status(200);
    return c.json([]);
  }

  await client.set(cacheKey, JSON.stringify(achievements), "EX", 3600);

  return c.json(achievements, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/related", async (c) => {
  const { id } = c.req.param();

  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `related-offers:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id }, { namespace: 1, id: 1 });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const related = await Offer.find(
    {
      namespace: offer.namespace,
      id: { $ne: offer.id },
    },
    undefined,
    {
      limit: 25,
    }
  );

  const prices = await PriceEngine.find({
    offerId: { $in: related.map((o) => o.id) },
    region,
  });

  const result = related.map((o) => {
    const price = prices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price: price ?? null,
    };
  });

  await client.set(cacheKey, JSON.stringify(related), "EX", 60);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/mappings", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `mappings:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const mappings = await Mappings.findOne({
    _id: id,
  });

  if (!mappings) {
    c.status(404);
    return c.json({
      message: "Mappings not found",
    });
  }

  await client.set(cacheKey, JSON.stringify(mappings), "EX", 86400);

  return c.json(mappings, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/media", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `media:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const media = await Media.findOne({
    _id: id,
  });

  if (!media) {
    c.status(404);
    return c.json({
      message: "Media not found",
    });
  }

  await client.set(cacheKey, JSON.stringify(media), "EX", 86400);

  return c.json(media, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/suggestions", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `suggestions:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const tagsIds = offer.tags.map((t) => t.id);
  const tagsInformation = await TagModel.find({
    id: { $in: tagsIds },
  });

  const genres = tagsInformation.filter((t) => t.groupName === "genre");

  const suggestions = await Offer.find(
    {
      tags: { $elemMatch: { id: { $in: genres.map((g) => g.id) } } },
      id: { $ne: id },
      namespace: { $ne: offer.namespace },
      offerType: { $in: ["BASE_GAME", "DLC"] },
    },
    undefined,
    {
      limit: 25,
      sort: {
        lastModifiedDate: -1,
      },
    }
  );

  const prices = await PriceEngine.find({
    offerId: { $in: suggestions.map((o) => o.id) },
    region: region,
  });

  const result = suggestions.map((o) => {
    const price = prices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price: price ?? null,
    };
  });

  await client.set(cacheKey, JSON.stringify(result), "EX", 60);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/age-rating", async (c) => {
  const { id } = c.req.param();
  const single = c.req.query("single");
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const cacheKey = `age-rating:${id}:${single ? "single" : "all"}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const sandbox = await Sandbox.findOne({
    _id: offer.namespace,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  const ageRatings = sandbox.ageGatings;

  if (!ageRatings) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  if (single) {
    const selectedRating =
      Object.entries(ageRatingsCountries).find(([, rating]) =>
        rating.includes(selectedCountry)
      )?.[0] ?? "Generic";

    const rating = ageRatings[selectedRating];

    if (!rating) {
      c.status(404);
      return c.json({
        message: "Age rating not found",
      });
    }

    return c.json(
      {
        [selectedRating]: rating,
      },
      200,
      {
        "Cache-Control": "public, max-age=60",
      }
    );
  }

  await client.set(cacheKey, JSON.stringify(ageRatings), "EX", 3600);

  return c.json(ageRatings, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/giveaways", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `giveaways:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const giveaways = await FreeGames.find(
    {
      id,
    },
    undefined,
    {
      sort: {
        startDate: -1,
      },
    }
  );

  await client.set(cacheKey, JSON.stringify(giveaways), "EX", 3600);

  return c.json(giveaways, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/ratings", async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const cacheKey = `ratings:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const sandbox = await Sandbox.findOne({
    _id: offer.namespace,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  const product = await db.db.collection("products").findOne({
    // @ts-expect-error - _id in products is a string
    _id: sandbox.parent,
  });

  if (!product) {
    c.status(404);
    return c.json({
      message: "Product not found",
    });
  }

  const ratings = await Ratings.findOne({
    _id: product.slug,
  });

  if (!ratings) {
    c.status(404);
    return c.json({
      message: "Ratings not found",
    });
  }

  await client.set(cacheKey, JSON.stringify(ratings), "EX", 3600);

  return c.json(ratings, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/tops", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `tops:${id}:all`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const positions = await GamePosition.find({
    offerId: id,
  });

  const result = positions.reduce((acc, position) => {
    acc[position.collectionId] = position.position;
    return acc;
  }, {} as Record<string, number>);

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/polls", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `polls:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const sandbox = await Sandbox.findOne({ _id: offer.namespace });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  const polls = await db.db
    .collection("ratings_polls")
    .find({
      // @ts-expect-error - _id in polls is a string
      _id: offer.namespace,
    })
    .toArray();

  await client.set(cacheKey, JSON.stringify(polls[0]), "EX", 3600);

  return c.json(polls[0], 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/reviews", epicInfo, async (c) => {
  const epic = c.var.epic;
  const session = c.var.session;
  const { id } = c.req.param();
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 25);
  const skip = (page - 1) * limit;

  const verifiedFilter = c.req.query("verified");

  const currentUser = session?.user?.email.split("@")[0] ?? epic?.account_id;

  const query: any = {
    id: id,
    userId: { $ne: currentUser },
  };

  if (verifiedFilter === "true") {
    query.verified = true;
  } else if (verifiedFilter === "false") {
    query.verified = false;
  }

  const reviews = await Review.find(query, undefined, {
    sort: {
      createdAt: -1,
    },
    limit,
    skip,
  });

  const userReview = currentUser
    ? await Review.findOne({
      userId: currentUser,
      id,
    })
    : null;

  if (userReview) {
    reviews.unshift(userReview);
  }

  if (!reviews) {
    c.status(200);
    return c.json({
      elements: [],
      page: 1,
      total: 0,
      limit,
    });
  }

  const users = await db.db
    .collection("epic")
    .find({
      accountId: { $in: reviews.map((r) => r.userId) },
    })
    .toArray();

  const result = {
    elements: reviews.map((r) => {
      const user = users.find((u) => u.accountId === r.userId);
      return {
        ...r.toObject(),
        user: user ?? null,
      };
    }),
    page,
    total: await Review.countDocuments(query),
    limit,
  };

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.post("/:id/reviews", epic, async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<
    Omit<IReview, "id" | "createdAt" | "verified" | "userId">
  >();
  const epic = c.var.epic;
  const session = c.var.session;

  if ((!epic || !epic.account_id) && !session) {
    c.status(401);
    return c.json({
      message: "Unauthorized",
    });
  }

  if (!body || !body.rating || !body.title || !body.content) {
    c.status(400);
    return c.json({
      message: "Missing required fields",
    });
  }

  // Check if the user already reviewed the product
  const existingReview = await Review.findOne({
    userId: session?.user?.email.split("@")[0] ?? epic?.account_id,
    id,
  });

  if (existingReview) {
    c.status(400);
    return c.json({
      message: "User already reviewed this product",
    });
  }

  const offer = await Offer.findOne({ id });

  if (
    !offer ||
    (offer.releaseDate || (offer.effectiveDate as Date)) > new Date()
  ) {
    c.status(400);
    return c.json({
      message: "Product not released",
    });
  }

  const product = await getProduct(id);

  if (!product) {
    c.status(404);
    return c.json({
      message: "Product not found",
    });
  }

  const isOwned =
    session?.user?.email.split("@")[0] ?? epic?.account_id
      ? await verifyGameOwnership(
        session?.user?.email.split("@")[0] ?? (epic?.account_id as string),
        product._id as unknown as string
      )
      : false;

  const review: IReview = {
    id,
    rating: body.rating,
    title: body.title,
    content: body.content,
    tags: body.tags.slice(0, 5),
    verified: isOwned,
    userId: (session?.user?.email.split("@")[0] ?? epic?.account_id) as string,
    createdAt: new Date(),
    recommended: body.recommended,
    updatedAt: new Date(),
  };

  await Review.create(review);

  return c.json(
    {
      status: "ok",
    },
    201
  );
});

app.patch("/:id/reviews", epic, async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<Omit<IReview, "id" | "createdAt" | "userId">>();
  const epic = c.var.epic;
  const session = c.var.session;

  if ((!epic || !epic.account_id) && !session) {
    c.status(401);
    return c.json({
      message: "Unauthorized",
    });
  }

  if (!body || !body.rating || !body.title || !body.content) {
    c.status(400);
    return c.json({
      message: "Missing required fields",
    });
  }

  const product = await getProduct(id);

  if (!product) {
    c.status(404);
    return c.json({
      message: "Product not found",
    });
  }

  const isOwned = ((session?.user?.email.split("@")[0] ??
    epic?.account_id) as string)
    ? await verifyGameOwnership(
      (session?.user?.email.split("@")[0] ?? epic?.account_id) as string,
      product._id as unknown as string
    )
    : false;

  const oldReview = await Review.findOne({
    userId: (session?.user?.email.split("@")[0] ?? epic?.account_id) as string,
    id,
  });

  if (!oldReview) {
    c.status(404);
    return c.json({
      message: "Review not found",
    });
  }

  const review: Omit<IReview, "id" | "createdAt" | "userId"> = {
    rating: body.rating,
    title: body.title,
    content: body.content,
    tags: body.tags.slice(0, 5),
    verified: isOwned,
    recommended: body.recommended,
    updatedAt: new Date(),
    editions: [
      ...(oldReview.editions || []),
      {
        rating: oldReview.rating,
        title: oldReview.title,
        content: oldReview.content,
        tags: oldReview.tags,
        recommended: oldReview.recommended,
        createdAt: oldReview.updatedAt,
      },
    ],
  };

  await Review.findOneAndUpdate(
    {
      userId: (session?.user?.email.split("@")[0] ??
        epic?.account_id) as string,
      id,
    },
    review
  );

  return c.json(
    {
      status: "ok",
    },
    200
  );
});

app.delete("/:id/reviews", epic, async (c) => {
  const { id } = c.req.param();
  const epic = c.var.epic;
  const session = c.var.session;

  if ((!epic || !epic.account_id) && !session) {
    c.status(401);
    return c.json({
      message: "Unauthorized",
    });
  }
  const review = await Review.findOne({
    userId: (session?.user?.email.split("@")[0] ?? epic?.account_id) as string,
    id,
  });

  if (!review) {
    c.status(404);
    return c.json({
      message: "Review not found",
    });
  }

  await Review.deleteOne({
    userId: (session?.user?.email.split("@")[0] ?? epic?.account_id) as string,
    id,
  });

  return c.json(
    {
      status: "ok",
    },
    200
  );
});

type ReviewSummary = {
  overallScore: number;
  recommendedPercentage: number;
  notRecommendedPercentage: number;
  totalReviews: number;
};

app.get("/:id/reviews-summary", async (c) => {
  const { id } = c.req.param();
  const verifiedFilter = c.req.query("verified");

  const cacheKey = `reviews-summary:${id}:${verifiedFilter}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const query: any = { id };

  if (verifiedFilter === "true") {
    query.verified = true;
  } else if (verifiedFilter === "false") {
    query.verified = false;
  }

  const reviews = await Review.find(query);

  if (!reviews || reviews.length === 0) {
    c.status(200);
    return c.json({
      totalReviews: 0,
      averageRating: 0,
      recommendedPercentage: 0,
      notRecommendedPercentage: 0,
    });
  }

  const totalReviews = reviews.length;
  const averageRating =
    reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews;
  const recommendedPercentage =
    reviews.filter((r) => r.recommended).length / totalReviews;
  const notRecommendedPercentage =
    reviews.filter((r) => !r.recommended).length / totalReviews;

  const summary: ReviewSummary = {
    overallScore: averageRating,
    recommendedPercentage,
    notRecommendedPercentage,
    totalReviews,
  };

  await client.set(cacheKey, JSON.stringify(summary), "EX", 3600);

  return c.json(summary, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/reviews/permissions", epic, async (c) => {
  const { id } = c.req.param();
  const epic = c.var.epic;
  const session = c.var.session;

  if ((!epic || !epic.account_id) && !session) {
    c.status(401);
    return c.json({
      message: "Unauthorized",
    });
  }

  const existingReview = await Review.findOne({
    userId: session?.user?.email.split("@")[0] ?? epic?.account_id,
    id,
  });

  return c.json({
    canReview: !existingReview,
  });
});

app.get("/:id/ownership", epic, async (c) => {
  const { id } = c.req.param();
  const epic = c.var.epic;
  const session = c.var.session;

  if ((!epic || !epic.account_id) && !session) {
    c.status(401);
    return c.json({
      message: "Unauthorized",
    });
  }

  const product = await getProduct(id);

  if (!product) {
    c.status(404);
    return c.json({
      message: "Product not found",
    });
  }

  const isOwned =
    session?.user?.email.split("@")[0] ?? epic?.account_id
      ? await verifyGameOwnership(
        session?.user?.email.split("@")[0] ?? (epic?.account_id as string),
        product._id as unknown as string
      )
      : false;

  return c.json({
    isOwned,
  });
});

app.get("/:id/hltb", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const start = new Date();

  const cacheKey = `hltb:${id}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const hltb = await Hltb.findOne({
    _id: id,
  });

  if (!hltb || !hltb.hltbId || hltb.hltbId === "00000") {
    return c.json(
      {
        error: "HowLongToBeat data not found for this offer",
      },
      {
        status: 404,
      }
    );
  }

  await client.set(cacheKey, JSON.stringify(hltb), "EX", 3600);

  return c.json(hltb, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/collection", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const { categories, customAttributes } = offer;

  if (!categories || !(categories.findIndex((c) => c === "collections") > -1)) {
    c.status(404);
    return c.json({
      message: "Selected offer does not have a collection",
    });
  }

  const cacheKey = `collection-offers:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  // Get the IDs of the collection offers
  const collectionOfferIds = customAttributes
    .filter((a) => a.key?.startsWith("com.epicgames.app.collectionOfferIds."))
    .map((a) => a.value);

  if (!collectionOfferIds.length || collectionOfferIds.length === 0) {
    c.status(404);
    return c.json({
      message: "Selected offer does not have a collection",
    });
  }

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: collectionOfferIds },
    }),
    PriceEngine.find({
      offerId: { $in: collectionOfferIds },
      region,
    }),
  ]);

  const offers = offersData.status === "fulfilled" ? offersData.value : [];
  const prices = pricesData.status === "fulfilled" ? pricesData.value : [];

  const result = offers.map((o) => {
    const price = prices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price: price ?? null,
    };
  });

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/collections/:collection", async (c) => {
  const { id, collection } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const [game, collectionData] = await Promise.all([
    GamePosition.findOne({
      collectionId: collection,
      offerId: id,
    }),
    Collection.findOne({ _id: collection }),
  ]);

  if (!game || !collectionData) {
    return c.json({ error: "Game not found" }, 404);
  }

  return c.json({
    ...game.toJSON(),
    name: collectionData.name,
  });
});

type BUNDLE_RESPONSE = {
  offers: OfferType[];
  bundlePrice: PriceType;
  totalPrice: PriceType;
};

app.get("/:id/bundle", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `bundle:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const [mainOfferData, mainPriceData] = await Promise.allSettled([
    Offer.findOne({ id }),
    PriceEngine.findOne({
      offerId: id,
      region,
    }),
  ]);

  const offer =
    mainOfferData.status === "fulfilled" ? mainOfferData.value : null;
  const mainPrice =
    mainPriceData.status === "fulfilled" ? mainPriceData.value : null;

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const { offerType } = offer;

  if (!offerType || (offerType !== "BUNDLE" && offerType !== "Bundle")) {
    c.status(404);
    return c.json({
      message: "Selected offer is not a bundle",
    });
  }

  const bundleData = await Bundles.findOne({ _id: offer.id });

  if (!bundleData) {
    c.status(404);
    return c.json({
      message: "Bundle not found",
    });
  }

  const bundleOfferIds = bundleData?.offers ?? [];

  const [bundleOffersData, bundlePricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: bundleOfferIds },
    }),
    PriceEngine.find({
      offerId: { $in: bundleOfferIds },
      region,
    }),
  ]);

  const bundleOffers =
    bundleOffersData.status === "fulfilled" ? bundleOffersData.value : [];
  const bundlePrices =
    bundlePricesData.status === "fulfilled" ? bundlePricesData.value : [];

  const offers = bundleOffers.map((o) => {
    const price = bundlePrices.find((p) => p.offerId === o.id);
    return {
      ...orderOffersObject(o),
      price: price ?? null,
    };
  });

  const result: BUNDLE_RESPONSE = {
    offers: offers,
    // @ts-expect-error
    totalPrice: offers.reduce(
      (acc, offer) => {
        const price = bundlePrices.find((p) => p.offerId === offer.id);

        // If there's no price for the offer, skip it
        if (!price) return acc;

        // Accumulate the price fields within the nested price object
        return {
          ...acc,
          price: {
            ...acc.price,
            currencyCode: price.price.currencyCode,
            discount: acc.price.discount + (price.price.discount ?? 0),
            discountPrice:
              acc.price.discountPrice + (price.price.discountPrice ?? 0),
            originalPrice:
              acc.price.originalPrice + (price.price.originalPrice ?? 0),
            basePayoutCurrencyCode: price.price.basePayoutCurrencyCode,
            basePayoutPrice:
              acc.price.basePayoutPrice + (price.price.basePayoutPrice ?? 0),
            payoutCurrencyExchangeRate: price.price.payoutCurrencyExchangeRate,
          },
        };
      },
      {
        country: mainPrice?.country ?? "US",
        offerId: id,
        region: mainPrice?.region ?? "US",
        namespace: mainPrice?.namespace ?? "epic",
        updatedAt: mainPrice?.updatedAt ?? new Date(),
        price: {
          discount: 0,
          discountPrice: 0,
          originalPrice: 0,
          basePayoutPrice: 0,
          currencyCode: "USD",
          basePayoutCurrencyCode: "USD",
          payoutCurrencyExchangeRate: 1,
        },
        appliedRules: [] as any[],
      }
    ),
    // @ts-expect-error
    bundlePrice: mainPrice,
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/in-bundle", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `in-bundle:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const bundleData = await Bundles.find({ offers: id });

  if (!bundleData) {
    c.status(404);
    return c.json({
      message: "Bundle not found",
    });
  }

  const bundles = await Promise.all(
    bundleData.flatMap(async (bundle) => {
      const id = bundle._id;
      const [bundleData, bundlePriceData] = await Promise.allSettled([
        Offer.findOne({ id }),
        PriceEngine.findOne({
          offerId: id,
          region,
        }),
      ]);

      const b = bundleData.status === "fulfilled" ? bundleData.value : null;
      const bp =
        bundlePriceData.status === "fulfilled" ? bundlePriceData.value : null;

      return {
        ...orderOffersObject(b),
        price: bp ?? null,
      };
    })
  );

  await client.set(cacheKey, JSON.stringify(bundles), "EX", 3600);

  return c.json(bundles, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/has-prepurchase", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `has-prepurchase:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const { namespace } = offer;

  const prePurchaseOffer = await Offer.findOne({
    namespace,
    offerType: "BASE_GAME",
    prePurchase: true,
    id: { $ne: id },
  });

  if (!prePurchaseOffer) {
    await client.set(cacheKey, JSON.stringify(false), "EX", 3600);
    return c.json(
      {
        hasPrepurchase: false,
      },
      200,
      {
        "Cache-Control": "public, max-age=60",
      }
    );
  }

  const price = await PriceEngine.findOne({
    offerId: prePurchaseOffer.id,
    region,
  });

  const result = {
    hasPrepurchase: true,
    offer: {
      ...orderOffersObject(prePurchaseOffer),
      price: price ?? null,
    },
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/has-regular", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const cacheKey = `has-regular:${id}:${region}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  if (offer.offerType !== "BASE_GAME") {
    return c.json({
      isPrepurchase: false,
    });
  }

  if (offer.prePurchase !== true) {
    return c.json({
      isPrepurchase: false,
    });
  }

  const { namespace } = offer;

  const prePurchaseOffer = await Offer.findOne({
    namespace,
    offerType: "BASE_GAME",
    prePurchase: { $ne: true },
    id: { $ne: id },
  });

  if (!prePurchaseOffer) {
    await client.set(cacheKey, JSON.stringify(true), "EX", 3600);
    return c.json(
      {
        isPrepurchase: false,
      },
      200,
      {
        "Cache-Control": "public, max-age=60",
      }
    );
  }

  const price = await PriceEngine.findOne({
    offerId: prePurchaseOffer.id,
    region,
  });

  const result = {
    isPrepurchase: true,
    offer: {
      ...orderOffersObject(prePurchaseOffer),
      price: price ?? null,
    },
  };

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id/genres", async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const genres = await Tags.find({
    groupName: "genre",
    status: "ACTIVE",
  });

  const result = offer.tags.filter((tag) =>
    genres?.map((genre) => genre?.id).includes(tag?.id)
  );

  return c.json(result);
});

app.get("/:id/price-stats", async (c) => {
  const { id } = c.req.param();
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry)
  );

  if (!region) {
    c.status(404);
    return c.json({
      message: "Country not found",
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    c.status(404);
    return c.json({
      message: "Offer not found",
    });
  }

  const [currentPrice, lowestPrice, lastDiscountPrice] = await Promise.all([
    PriceEngine.findOne(
      {
        offerId: id,
        region,
      },
      undefined,
      {
        sort: {
          updatedAt: -1,
        },
      }
    ),
    PriceEngineHistorical.findOne(
      {
        offerId: id,
        region,
        "price.discount": { $gt: 0 },
      },
      undefined,
      {
        sort: {
          "price.discountPrice": 1,
        },
      }
    ),
    PriceEngineHistorical.findOne(
      {
        offerId: id,
        region,
        "price.discount": { $gt: 0 },
      },
      undefined,
      {
        sort: {
          updatedAt: -1,
        },
      }
    ),
  ]);

  return c.json({
    current: currentPrice,
    lowest: lowestPrice,
    lastDiscount: lastDiscountPrice,
  });
});

app.get("/:id/technologies", async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const itemsSpecified = offer.items.map((item) => item.id);

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...itemsSpecified,
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  const assets = await Asset.find({
    itemId: { $in: items.map((i) => i.id) },
  });

  const builds = await db.db
    .collection<{
      appName: string;
      labelName: string;
      buildVersion: string;
      hash: string;
      metadata: {
        installationPoolId: string;
      };
      createdAt: {
        $date: string;
      };
      updatedAt: {
        $date: string;
      };
      technologies: Array<{
        section: string;
        technology: string;
      }>;
      downloadSizeBytes: number;
      installedSizeBytes: number;
    }>("builds")
    .aggregate([
      { $match: { appName: { $in: assets.map((a) => a.artifactId) } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$appName",
          doc: { $first: "$$ROOT" },
        },
      },
    ])
    .toArray();

  const latestBuilds = builds.map((b) => b.doc);

  const technologies = latestBuilds
    .flatMap((b) => b.technologies)
    .filter(Boolean)
    .reduce((acc, tech) => {
      if (
        !acc.find(
          (a: { section: string; technology: string }) =>
            a.technology === tech.technology
        )
      ) {
        acc.push(tech);
      }
      return acc;
    }, [] as { section: string; technology: string }[]);

  return c.json(technologies);
});

app.get("/:id/builds", async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const itemsSpecified = offer.items.map((item) => item.id);

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...itemsSpecified,
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  const assets = await Asset.find({
    itemId: { $in: items.map((i) => i.id) },
  });

  const builds = await db.db
    .collection<{
      appName: string;
      labelName: string;
      buildVersion: string;
      hash: string;
      metadata: {
        installationPoolId: string;
      };
      createdAt: {
        $date: string;
      };
      updatedAt: {
        $date: string;
      };
      technologies: Array<{
        section: string;
        technology: string;
      }>;
      downloadSizeBytes: number;
      installedSizeBytes: number;
    }>("builds")
    .find({
      appName: { $in: assets.map((a) => a.artifactId) },
    })
    .toArray();

  return c.json(builds);
});

app.get("/:id/assets", async (c) => {
  const { id } = c.req.param();

  const offer = await Offer.findOne({ id });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const itemsSpecified = offer.items.map((item) => item.id);

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...itemsSpecified,
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  const assets = await Asset.find({
    itemId: { $in: items.map((i) => i.id) },
  });

  return c.json(assets);
});

app.get("/:id/builds", async (c) => {
  const { id } = c.req.param();

  const cacheKey = `offer:builds:${id}`;

  // 1 day
  const cacheTTL = 86400;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": `public, max-age=${cacheTTL}`,
    });
  }

  const offer = await Offer.findOne({ id });

  if (!offer) {
    return c.json({ error: "Offer not found" }, 404);
  }

  const itemsSpecified = offer.items.map((item) => item.id);

  const subItems = await OfferSubItems.find({
    _id: id,
  });

  const items = await Item.find({
    $or: [
      {
        id: {
          $in: [
            ...itemsSpecified,
            ...subItems.flatMap((i) => i.subItems.map((s) => s.id)),
          ],
        },
      },
      { linkedOffers: id },
    ],
  });

  const assets = await Asset.find({
    itemId: { $in: items.map((i) => i.id) },
  });

  const builds = await db.db
    .collection<{
      appName: string;
      labelName: string;
      buildVersion: string;
      hash: string;
    }>("builds")
    .find({
      appName: { $in: assets.map((a) => a.artifactId) },
    })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();

  await client.set(cacheKey, JSON.stringify(builds), "EX", 3600);

  return c.json(builds, 200, {
    "Cache-Control": `public, max-age=${cacheTTL}`,
  });
});

app.get("/:id/igdb", async (c) => {
  const { id } = c.req.param();

  const igdb = await db.db.collection("igdb").findOne({
    offerId: id,
  });

  if (!igdb) {
    return c.json({ error: "IGDB data not found" }, 404);
  }

  return c.json(igdb);
});

export default app;
