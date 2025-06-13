import { Hono } from "hono";
import client from "../clients/redis.js";
import { Offer } from "@egdata/core.schemas.offers";
import { Item } from "@egdata/core.schemas.items";
import { Tags } from "@egdata/core.schemas.tags";
import { Asset } from "@egdata/core.schemas.assets";
import { PriceEngine } from "@egdata/core.schemas.price";
import { Changelog } from "@egdata/core.schemas.changelog";
import { db } from "../db/index.js";

const app = new Hono();

app.get("/", async (c) => {
  const cacheKey = "stats:v0.3";

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  const [
    offersData,
    itemsData,
    tagsData,
    assetsData,
    priceEngineData,
    changelogData,
    sandboxData,
    productsData,
    offersYearData,
    itemsYearData,
  ] = await Promise.allSettled([
    Offer.countDocuments(),
    Item.countDocuments(),
    Tags.countDocuments(),
    Asset.countDocuments(),
    PriceEngine.countDocuments(),
    Changelog.countDocuments(),
    db.db.collection("sandboxes").countDocuments(),
    db.db.collection("products").countDocuments(),
    Offer.countDocuments({
      creationDate: {
        $gte: new Date(new Date().getFullYear(), 0, 1),
        $lt: new Date(new Date().getFullYear() + 1, 0, 1),
      },
    }),
    Item.countDocuments({
      creationDate: {
        $gte: new Date(new Date().getFullYear(), 0, 1),
        $lt: new Date(new Date().getFullYear() + 1, 0, 1),
      },
    }),
  ]);

  const offers = offersData.status === "fulfilled" ? offersData.value : 0;
  const items = itemsData.status === "fulfilled" ? itemsData.value : 0;
  const tags = tagsData.status === "fulfilled" ? tagsData.value : 0;
  const assets = assetsData.status === "fulfilled" ? assetsData.value : 0;
  const priceEngine =
    priceEngineData.status === "fulfilled" ? priceEngineData.value : 0;
  const changelog =
    changelogData.status === "fulfilled" ? changelogData.value : 0;
  const sandboxes = sandboxData.status === "fulfilled" ? sandboxData.value : 0;
  // @ts-ignore-next-line
  const products = productsData.status === "fulfilled" ? sandboxData.value : 0;
  const offersYear =
    offersYearData.status === "fulfilled" ? offersYearData.value : 0;
  const itemsYear =
    itemsYearData.status === "fulfilled" ? itemsYearData.value : 0;

  const res = {
    offers,
    items,
    tags,
    assets,
    priceEngine,
    changelog,
    sandboxes,
    products,
    offersYear,
    itemsYear,
  };

  await client.set(cacheKey, JSON.stringify(res), "EX", 3600);

  return c.json(res, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/releases/monthly", async (c) => {
  const cacheKey = "stats:releases:monthly";

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  const result = await Offer.aggregate([
    {
      $match: {
        prePurchase: { $ne: true }, // keep null/false/missing
        isCodeRedemptionOnly: { $ne: true }, // keep null/false/missing
        releaseDate: {
          $ne: null,
          $lte: new Date(),
          $gte: new Date("2018-12-06"),
        },
        offerType: { $eq: "BASE_GAME" },
      },
    },

    {
      $group: {
        _id: {
          year: { $year: "$releaseDate" },
          month: { $month: "$releaseDate" },
        },
        releases: { $sum: 1 },
      },
    },

    { $sort: { "_id.year": 1, "_id.month": 1 } },

    {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        releases: 1,
      },
    },
  ]);

  // Cache for 1 day
  await client.set(cacheKey, JSON.stringify(result), "EX", 86400);

  return c.json(result, 200);
});

app.get("/releases/yearly", async (c) => {
  const cacheKey = "stats:releases:yearly";

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  }

  const result = await Offer.aggregate([
    {
      $match: {
        prePurchase: { $ne: true }, // keep null/false/missing
        isCodeRedemptionOnly: { $ne: true }, // keep null/false/missing
        releaseDate: {
          $ne: null,
          $lte: new Date(),
          $gte: new Date("2018-12-06"),
        },
        offerType: { $eq: "BASE_GAME" },
      },
    },

    {
      $group: {
        _id: {
          year: { $year: "$releaseDate" },
        },
        releases: { $sum: 1 },
      },
    },

    { $sort: { "_id.year": 1 } },

    {
      $project: {
        _id: 0,
        year: "$_id.year",
        releases: 1,
      },
    },
  ]);

  // Cache for 1 day
  await client.set(cacheKey, JSON.stringify(result), "EX", 86400);

  return c.json(result, 200);
});

export default app;
