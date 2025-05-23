import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { AchievementSet } from "@egdata/core.schemas.achievements";
import { Asset, type AssetType } from "@egdata/core.schemas.assets";
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

type RegenOfferQueueType = { slug: string } | { id: string; namespace?: string };

const regenOffersQueue = new Queue<RegenOfferQueueType>("regenOffersQueue", { connection: ioredis });

const app = new Hono();

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

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

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

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

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

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 360,
  });

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
    await client.set(cacheKey, JSON.stringify(response), {
      EX: 3600,
    });
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
    await client.set(cacheKey, JSON.stringify(response), {
      EX: 3600,
    });
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
  const cacheKey = `featured-discounts:${region}:v0.1`;
  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }
  const featuredOffers = await GamePosition.find({}).sort({ position: 1 });
  const offersIds = featuredOffers.flatMap((o) => o.offerId);
  const [offers, prices] = await Promise.all([
    Offer.find({
      id: { $in: offersIds },
      offerType: {
        $in: ["BASE_GAME", "DLC"],
      },
    }),
    PriceEngine.find(
      {
        offerId: { $in: offersIds },
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
  const result = prices
    .map((p) => {
      const offer = offers.find((o) => o.id === p.offerId);
      return {
        ...offer?.toObject(),
        price: p,
      };
    })
    .filter((o) => o.title)
    .slice(0, 20);
  // Save the result in cache, set the expiration to the first sale ending date
  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });
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
  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });
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
  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });
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

app.post("/slugs", async (c) => {
  const { slugs } = await c.req.json<{ slugs: string[] }>();

  if (!slugs || !Array.isArray(slugs) || slugs.length === 0) {
    c.status(400);
    return c.json({
      message: "Missing or invalid slugs parameter. Expecting an array of strings.",
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
              $elemMatch: { key: "com.epicgames.app.productSlug", value: { $in: expandedSlugs } },
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
  }).select("id productSlug urlSlug offerMappings customAttributes prePurchase");

  const result = slugs.map((originalSlug) => {
    const offer = offers.find((o) => {
      const checkSlug = (s: string | undefined) => s === originalSlug || s === `${originalSlug}/home`;

      if (checkSlug(o.productSlug)) return true;
      if (checkSlug(o.urlSlug)) return true;
      if (o.offerMappings?.some((m: any) => checkSlug(m.pageSlug))) return true;
      if (
        o.customAttributes?.some((attr: any) =>
          attr.key === "com.epicgames.app.productSlug" && checkSlug(attr.value)
        )
      )
        return true;
      if (
        o.customAttributes?.some((attr: any) =>
          attr.key === "slug" && checkSlug(attr.value)
        )
      )
        return true;
      return false;
    });
    return {
      slug: originalSlug,
      id: offer ? offer.id : null,
    };
  });

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

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

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

  await client.set(cacheKey, JSON.stringify(bundles), {
    EX: 3600,
  });

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
    await client.set(cacheKey, JSON.stringify(false), {
      EX: 3600,
    });
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

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

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
    await client.set(cacheKey, JSON.stringify(true), {
      EX: 3600,
    });
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

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

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

export default app;
