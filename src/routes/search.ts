import { createHash } from "node:crypto";
import { Hono } from "hono";
import client from "../clients/redis.js";
import { Offer } from "@egdata/core.schemas.offers";
import { Tags } from "@egdata/core.schemas.tags";
import type { PipelineStage } from "mongoose";
import { regions } from "../utils/countries.js";
import { getCookie } from "hono/cookie";
import { db } from "../db/index.js";
import type { ChangelogType } from "@egdata/core.schemas.changelog";
import { meiliSearchClient } from "../clients/meilisearch.js";
import { Item } from "@egdata/core.schemas.items";
import { Asset } from "@egdata/core.schemas.assets";
import { ObjectId } from "mongodb";
import type { Filter } from "meilisearch";

interface SearchBody {
  title?: string;
  offerType?:
    | "IN_GAME_PURCHASE"
    | "BASE_GAME"
    | "EXPERIENCE"
    | "UNLOCKABLE"
    | "ADD_ON"
    | "Bundle"
    | "CONSUMABLE"
    | "WALLET"
    | "OTHERS"
    | "DEMO"
    | "DLC"
    | "VIRTUAL_CURRENCY"
    | "BUNDLE"
    | "DIGITAL_EXTRA"
    | "EDITION";
  tags?: string[];
  customAttributes?: string[];
  seller?: string;
  sortBy?:
    | "releaseDate"
    | "lastModifiedDate"
    | "effectiveDate"
    | "creationDate"
    | "viewableDate"
    | "pcReleaseDate"
    | "upcoming"
    | "priceAsc"
    | "priceDesc"
    | "price"
    | "discount"
    | "discountPercent";
  sortDir?: "asc" | "desc";
  limit?: number;
  page?: number;
  refundType?: string;
  isCodeRedemptionOnly?: boolean;
  price?: {
    min?: number;
    max?: number;
  };
  onSale?: boolean;
  categories?: string[];
  developerDisplayName?: string;
  publisherDisplayName?: string;
  spt?: boolean;
  excludeBlockchain?: boolean;
}

interface MongoQuery {
  $text?: {
    $search: string;
    $language: string;
  };
  offerType?: string;
  "tags.id"?: { $all: string[] } | { $ne: string };
  customAttributes?: {
    $elemMatch: { id: { $in: string[] } };
  };
  categories?: { $all: string[] };
  $or?: Array<{ "seller.name": string } | { "seller.id": string }>;
  refundType?: string;
  isCodeRedemptionOnly?: boolean;
  developerDisplayName?: string;
  publisherDisplayName?: string;
  "keyImages.url"?: { $regex: RegExp };
  [key: string]: any;
}

interface PriceQuery {
  "price.discountPrice"?: {
    $gte?: number;
    $lte?: number;
  };
  "price.discount"?: { $gt: number };
}

function buildBaseQuery(query: SearchBody): MongoQuery {
  const mongoQuery: MongoQuery = {};

  if (query.title) {
    mongoQuery.$text = {
      $search: query.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(" ")
        .map((q) => `"${q.trim()}"`)
        .join(" | "),
      $language: "en",
    };
  }

  if (query.offerType) {
    mongoQuery.offerType = query.offerType;
  }

  if (query.tags) {
    mongoQuery["tags.id"] = { $all: query.tags };
  }

  if (query.customAttributes) {
    mongoQuery.customAttributes = {
      $elemMatch: { id: { $in: query.customAttributes } },
    };
  }

  if (query.categories) {
    mongoQuery.categories = { $all: query.categories };
  }

  if (query.seller) {
    mongoQuery.$or = [
      { "seller.name": query.seller },
      { "seller.id": query.seller }
    ];
  }

  if (query.refundType) {
    mongoQuery.refundType = query.refundType;
  }

  if (query.isCodeRedemptionOnly !== undefined) {
    mongoQuery.isCodeRedemptionOnly = query.isCodeRedemptionOnly;
  }

  if (query.excludeBlockchain) {
    if (query.tags) {
      mongoQuery["tags.id"].$ne = "21739";
    } else {
      mongoQuery["tags.id"] = { $ne: "21739" };
    }
  }

  if (query.developerDisplayName) {
    mongoQuery.developerDisplayName = query.developerDisplayName;
  }

  if (query.publisherDisplayName) {
    mongoQuery.publisherDisplayName = query.publisherDisplayName;
  }

  if (query.spt) {
    mongoQuery["keyImages.url"] = { $regex: /spt/i };
  }

  return mongoQuery;
}

function buildPriceQuery(query: SearchBody): PriceQuery {
  const priceQuery: PriceQuery = {};

  if (query.price) {
    if (query.price.min !== undefined && query.price.min !== null) {
      priceQuery["price.discountPrice"] = {
        $gte: query.price.min,
      };
    }

    if (query.price.max !== undefined && query.price.max !== null) {
      priceQuery["price.discountPrice"] = {
        ...priceQuery["price.discountPrice"],
        $lte: query.price.max,
      };
    }
  }

  if (query.onSale || ["discount", "discountPercent"].includes(query.sortBy || "")) {
    priceQuery["price.discount"] = { $gt: 0 };
  }

  return priceQuery;
}

function buildSortParams(query: SearchBody, sort: string, dir: number): Record<string, 1 | -1 | { $meta: string }> {
  let sortParams: Record<string, 1 | -1 | { $meta: string }> = {};

  if (query.title) {
    sortParams = {
      score: { $meta: "textScore" },
    };
  }

  if (!["upcoming", "priceAsc", "priceDesc", "price", "discount", "discountPercent"].includes(sort)) {
    sortParams[sort] = dir;
  } else if (sort === "upcoming") {
    sortParams = {
      releaseDate: 1,
    };
  } else {
    sortParams = {
      lastModifiedDate: dir,
    };
  }

  return sortParams;
}

const app = new Hono();

app.get("/", (c) => c.json("Hello, World!"));

app.post("/", async (c) => {
  const start = new Date();

  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const region =
    Object.keys(regions).find((r) =>
      regions[r].countries.includes(selectedCountry)
    ) || "US";

  const body = await c.req.json().catch((err) => {
    c.status(400);
    return null;
  });

  if (!body) {
    return c.json({
      message: "Invalid body",
    });
  }

  const query = body as SearchBody;

  const queryId = createHash("md5")
    .update(
      JSON.stringify({
        ...query,
        page: undefined,
        limit: undefined,
      })
    )
    .digest("hex");

  const cacheKey = `offers:search:${queryId}:${region}:${query.page}:${query.limit}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    console.warn(`Cache hit for ${cacheKey}`);
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  console.warn(`Cache miss for ${cacheKey}`);

  const queryCache = `q:${queryId}`;

  const cachedQuery = await client.get(queryCache);

  if (!cachedQuery) {
    console.warn(`Cache miss for ${queryCache}`);
    await client.set(queryCache, JSON.stringify(query));
  } else {
    console.warn(`Cache hit for ${queryCache}`);
  }

  const limit = Math.min(query.limit || 10, 50);
  const page = Math.max(query.page || 1, 1);

  let sort = query.sortBy || "lastModifiedDate";
  const sortDir = query.sortDir || "desc";
  const dir = sortDir === "asc" ? 1 : -1;

  const mongoQuery = buildBaseQuery(query);
  const priceQuery = buildPriceQuery(query);

  // Add date-based filters
  if (["effectiveDate", "creationDate", "viewableDate"].includes(sort)) {
    mongoQuery[sort] = { $lt: new Date("2090-01-01") };
  }

  if (["releaseDate", "pcReleaseDate"].includes(sort)) {
    mongoQuery[sort] = { $lte: new Date() };
  }

  if (["upcoming"].includes(sort)) {
    mongoQuery["releaseDate"] = {
      $gte: new Date(),
    };
  }

  if (!sort) {
    mongoQuery.lastModifiedDate = { $lt: new Date() };
  }

  let offersPipeline: PipelineStage[] = [];
  let collection = "offers";

  if (["priceAsc", "priceDesc", "price", "discount", "discountPercent"].includes(sort)) {
    let priceSortOrder: 1 | -1 =
      sort === "priceAsc" || sort === "priceDesc"
        ? sort === "priceAsc"
          ? 1
          : -1
        : dir;

    const sortKey = () => {
      if (sort === "discountPercent") {
        return "appliedRules.discountSetting.discountPercentage";
      }

      if (sort === "discount") {
        return "price.discount";
      }

      return "price.discountPrice";
    };

    if (sort === "discountPercent") {
      priceSortOrder = priceSortOrder * -1;
    }

    collection = "pricev2";
    offersPipeline = [
      {
        $match: {
          region: region,
          ...priceQuery,
        },
      },
      {
        $sort: {
          [sortKey()]: priceSortOrder,
        },
      },
      {
        $addFields: {
          price: "$$ROOT",
        },
      },
      {
        $lookup: {
          from: "offers",
          localField: "offerId",
          foreignField: "id",
          as: "offerDetails",
        },
      },
      {
        $unwind: "$offerDetails",
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ["$offerDetails", "$$ROOT"],
          },
        },
      },
      {
        $match: mongoQuery,
      },
      {
        $skip: (page - 1) * limit,
      },
      {
        $limit: limit,
      },
      {
        $project: {
          discountPrice: 0,
          offerDetails: 0,
          appliedRules: 0,
          region: 0,
          country: 0,
          offerId: 0,
          updatedAt: 0,
        },
      },
    ];
  } else {
    offersPipeline = [
      {
        $match: mongoQuery,
      },
      {
        $sort: {
          ...(query.title ? { score: { $meta: "textScore" } } : {}),
          ...buildSortParams(query, sort, dir),
        },
      },
      {
        $lookup: {
          from: "pricev2",
          localField: "id",
          foreignField: "offerId",
          as: "priceEngine",
          pipeline: [
            {
              $match: {
                region: region,
                ...priceQuery,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          price: { $arrayElemAt: ["$priceEngine", 0] },
        },
      },
      {
        $match: {
          price: { $ne: null },
        },
      },
      {
        $project: {
          priceEngine: 0,
        },
      },
      {
        $skip: (page - 1) * limit,
      },
      {
        $limit: limit,
      },
    ];
  }

  const dbColl = db.db.collection(collection);

  const aggregation = dbColl.aggregate(offersPipeline);

  const offersData = await aggregation.toArray();

  const result = {
    elements: offersData.sort((a, b) => {
      if (query.sortBy === "price" && query.title) {
        if (sortDir === "asc") {
          return a.price.price.discountPrice - b.price.price.discountPrice;
        }
        return b.price.price.discountPrice - a.price.price.discountPrice;
      }

      return 0;
    }),
    page,
    limit,
    query: queryId,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 60,
  });

  return c.json(result, 200, {
    "Server-Timing": `db;dur=${new Date().getTime() - start.getTime()}`,
  });
});

app.get("/tags", async (c) => {
  const tags = await Tags.find({
    status: "ACTIVE",
  });

  return c.json(tags, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/offer-types", async (c) => {
  const types = await Offer.aggregate([
    { $group: { _id: "$offerType", count: { $sum: 1 } } },
  ]);

  return c.json(
    types.filter((t) => t._id),
    200,
    {
      "Cache-Control": "public, max-age=60",
    }
  );
});

app.get("/developers", async (c) => {
  const query = c.req.query("query");

  const pipeline: PipelineStage[] = [
    {
      $group: {
        _id: "$developerDisplayName",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ];

  if (query) {
    pipeline.unshift({
      $match: {
        developerDisplayName: { $regex: new RegExp(query, "i") },
      },
    });
  }

  const developers = await Offer.aggregate(pipeline);

  return c.json(developers, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/publishers", async (c) => {
  const query = c.req.query("query");

  const pipeline: PipelineStage[] = [
    {
      $group: {
        _id: "$publisherDisplayName",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ];

  if (query) {
    pipeline.unshift({
      $match: {
        publisherDisplayName: { $regex: new RegExp(query, "i") },
      },
    });
  }

  const publishers = await Offer.aggregate(pipeline);

  return c.json(publishers, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/changelog", async (c) => {
  // Get the search opts (query, page, limit, type)
  const {
    query,
    page: requestedPage,
    limit: requestedLimit,
    type,
    id,
  } = c.req.query();

  // Parse the page and limit
  const page = Math.max(Number.parseInt(requestedPage, 10) || 1, 1);
  const limit = Math.min(Number.parseInt(requestedLimit, 10) || 10, 50);

  const filter: Filter = [];

  if (id) {
    filter.push(`metadata.contextId = "${id}"`);
  }

  if (type) {
    filter.push(`metadata.contextType = "${type}"`);
  }

  // Remove contextType = 'file' from the results
  filter.push(`metadata.contextType != "file"`);

  // Remove contextType = 'achievements' from the results
  filter.push(`metadata.contextType != "achievements"`);

  const changelogs = await meiliSearchClient.index("changelog").search<
    ChangelogType & {
      document: unknown;
    }
  >(query, {
    offset: (page - 1) * limit,
    limit,
    sort: ["timestamp:desc"],
    filter,
  });

  await Promise.all(
    changelogs.hits
      .filter((hit) => hit.metadata)
      .map(async (hit) => {
        const type = hit.metadata.contextType;
        const id = hit.metadata.contextId;

        if (type === "offer") {
          hit.document = await Offer.findOne({ id });
        }

        if (type === "item") {
          hit.document = await Item.findOne({
            id,
          });
        }

        if (type === "asset") {
          const asset = await Asset.findOne({
            artifactId: id,
          });

          hit.document = await Item.findOne({
            id: asset?.itemId,
          });
        }

        if (type === "build") {
          const build = await db.db.collection("builds").findOne({
            _id: new ObjectId(id),
          });

          hit.document = build;
        }

        return hit;
      })
  );

  // Return the changelogs
  return c.json(changelogs, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:id", async (c) => {
  const { id } = c.req.param();

  const queryKey = `q:${id}`;

  const cachedQuery = await client.get(queryKey);

  if (!cachedQuery) {
    c.status(404);
    return c.json({
      message: "Query not found",
    });
  }

  return c.json(JSON.parse(cachedQuery));
});

app.get("/:id/count", async (c) => {
  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  // Get the region for the selected country
  const region =
    Object.keys(regions).find((r) =>
      regions[r].countries.includes(selectedCountry)
    ) || "US";

  const { id } = c.req.param();

  const queryKey = `q:${id}`;

  const cacheKey = `search:count:${id}:${region}:v0.5`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const cachedQuery = await client.get(queryKey);

  if (!cachedQuery) {
    c.status(404);
    return c.json({
      message: "Query not found",
    });
  }

  const query = JSON.parse(cachedQuery);

  const mongoQuery: Record<string, any> = {};
  const priceQuery: Record<string, any> = {};

  if (query.title) {
    mongoQuery.title = { $regex: new RegExp(query.title, "i") };
  }

  if (query.offerType) {
    mongoQuery.offerType = query.offerType;
  }

  /**
   * The tags query should be "and", so we need to find the offers that have all the tags provided by the user
   */
  if (query.tags) {
    mongoQuery["tags.id"] = { $all: query.tags };
  }

  if (query.customAttributes) {
    mongoQuery.customAttributes = {
      $elemMatch: { id: { $in: query.customAttributes } },
    };
  }

  if (query.categories) {
    mongoQuery["categories"] = { $all: query.categories };
  }

  if (query.seller) {
    mongoQuery["$or"] = [
      { "seller.name": query.seller },
      { "seller.id": query.seller }
    ];
  }

  if (query.developerDisplayName) {
    mongoQuery.developerDisplayName = query.developerDisplayName;
  }

  if (query.publisherDisplayName) {
    mongoQuery.publisherDisplayName = query.publisherDisplayName;
  }

  if (query.refundType) {
    mongoQuery.refundType = query.refundType;
  }

  if (query.isCodeRedemptionOnly !== undefined) {
    mongoQuery.isCodeRedemptionOnly = query.isCodeRedemptionOnly;
  }

  if (query.excludeBlockchain) {
    if (query.tags) {
      mongoQuery["tags.id"].$ne = "21739";
    } else {
      mongoQuery["tags.id"] = { $ne: "21739" };
    }
  }

  if (query.price) {
    if (query.price.min) {
      priceQuery["price.discountPrice"] = {
        $gte: query.price.min,
      };
    }

    if (query.price.max) {
      priceQuery["price.discountPrice"] = {
        ...priceQuery["price.discountPrice"],
        $lte: query.price.max,
      };
    }
  }

  if (query.onSale) {
    priceQuery["price.discount"] = { $gt: 0 };
  }

  try {
    const [
      tagCountsData,
      offerTypeCountsData,
      totalCountData,
      developerData,
      publisherData,
      priceRangeData,
    ] = await Promise.allSettled([
      Offer.aggregate([
        { $match: mongoQuery },
        {
          $lookup: {
            from: "pricev2",
            localField: "id",
            foreignField: "offerId",
            as: "priceEngine",
            pipeline: [
              {
                $match: {
                  region: "EURO",
                  ...priceQuery,
                },
              },
            ],
          },
        },
        {
          $addFields: {
            price: { $arrayElemAt: ["$priceEngine", 0] },
          },
        },
        {
          $match: {
            price: { $ne: null },
          },
        },
        { $unwind: "$tags" },
        { $group: { _id: "$tags.id", count: { $sum: 1 } } },
      ]),
      Offer.aggregate([
        { $match: mongoQuery },
        {
          $lookup: {
            from: "pricev2",
            localField: "id",
            foreignField: "offerId",
            as: "priceEngine",
            pipeline: [
              {
                $match: {
                  region: "EURO",
                  ...priceQuery,
                },
              },
            ],
          },
        },
        {
          $addFields: {
            price: { $arrayElemAt: ["$priceEngine", 0] },
          },
        },
        {
          $match: {
            price: { $ne: null },
          },
        },
        { $group: { _id: "$offerType", count: { $sum: 1 } } },
      ]),
      Offer.aggregate([
        { $match: mongoQuery },
        // Append the price query to the pipeline
        {
          $lookup: {
            from: "pricev2",
            localField: "id",
            foreignField: "offerId",
            as: "priceEngine",
            pipeline: [
              {
                $match: {
                  region: "EURO",
                  ...priceQuery,
                },
              },
            ],
          },
        },
        {
          $addFields: {
            price: { $arrayElemAt: ["$priceEngine", 0] },
          },
        },
        {
          $match: {
            price: { $ne: null },
          },
        },
        {
          $count: "total",
        },
      ]),
      Offer.aggregate([
        { $match: mongoQuery },
        {
          $unwind: "$developerDisplayName",
        },
        {
          $group: {
            _id: "$developerDisplayName",
            count: { $sum: 1 },
          },
        },
      ]),
      Offer.aggregate([
        { $match: mongoQuery },
        {
          $unwind: "$publisherDisplayName",
        },
        {
          $group: {
            _id: "$publisherDisplayName",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Offer.aggregate([
        { $match: mongoQuery },
        {
          $lookup: {
            from: "pricev2",
            localField: "id",
            foreignField: "offerId",
            as: "priceEngine",
            pipeline: [
              {
                $match: {
                  region: region,
                },
              },
            ],
          },
        },
        {
          $unwind: "$priceEngine",
        },
        {
          $group: {
            _id: null,
            minPrice: { $min: "$priceEngine.price.discountPrice" },
            maxPrice: { $max: "$priceEngine.price.discountPrice" },
            currency: { $first: "$priceEngine.price.currencyCode" },
          },
        },
      ]),
    ]);

    const result = {
      tagCounts:
        tagCountsData.status === "fulfilled" ? tagCountsData.value : [],
      offerTypeCounts:
        offerTypeCountsData.status === "fulfilled"
          ? offerTypeCountsData.value
          : [],
      total:
        totalCountData.status === "fulfilled"
          ? totalCountData.value[0]?.total
          : 0,
      developer:
        developerData.status === "fulfilled" ? developerData.value : [],
      publisher:
        publisherData.status === "fulfilled" ? publisherData.value : [],
      priceRange:
        priceRangeData.status === "fulfilled" && priceRangeData.value.length > 0
          ? priceRangeData.value[0]
          : { minPrice: null, maxPrice: null },
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 86400,
    });

    return c.json(result, 200, {
      "Cache-Control": "public, max-age=60",
    });
  } catch (err) {
    c.status(500);
    c.json({ message: "Error while counting tags" });
  }
});

export default app;
