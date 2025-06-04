import { Hono } from "hono";
import client from "../clients/redis.js";
import { AchievementSet } from "@egdata/core.schemas.achievements";
import { Namespace } from "@egdata/core.schemas.namespace";
import { Item } from "@egdata/core.schemas.items";
import { Offer } from "@egdata/core.schemas.offers";
import { Asset } from "@egdata/core.schemas.assets";
import { db } from "../db/index.js";
import { PriceEngine } from "@egdata/core.schemas.price";
import { regions } from "../utils/countries.js";
import { getCookie } from "hono/cookie";
import { orderOffersObject } from "../utils/order-offers-object.js";
import { Changelog } from "@egdata/core.schemas.changelog";
import { ObjectId } from "mongodb";
import { consola } from "../utils/logger.js";
import { RootFilterQuery } from "mongoose";

const app = new Hono();

app.get("/", async (ctx) => {
  const start = Date.now();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(
    Number.parseInt(ctx.req.query("limit") || "10", 10),
    100
  );
  const skip = (page - 1) * limit;

  const cacheKey = `sandboxes-list:${page}:${limit}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return ctx.json(JSON.parse(cached), 200, {
      "Server-Timing": `cache;dur=${Date.now() - start}`,
    });
  }

  const sandboxes = await Namespace.find(
    {},
    {
      _id: false,
      __v: false,
    },
    {
      skip,
      limit,
    }
  );

  const count = await Namespace.countDocuments();

  const response = {
    elements: sandboxes,
    page,
    limit,
    count,
  };

  await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

  return ctx.json(response, 200, {
    "Server-Timing": `db;dur=${Date.now() - start}`,
  });
});

app.get("/sitemap.xml", async (c) => {
  const start = Date.now();
  const limit = 1000;
  const { page } = c.req.query();

  if (!page) {
    // Show the sitemap index, which contains the other sitemaps for all pages
    const count = await db.db.collection("sandboxes").countDocuments();
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${Array.from(
    { length: Math.ceil(count / limit) },
    (_, i) =>
      `<sitemap><loc>https://api.egdata.app/sandboxes/sitemap.xml?page=${
        i + 1
      }</loc></sitemap>`
  ).join("")}
</sitemapindex>`;

    return c.text(sitemap, 200, {
      "Content-Type": "application/xml",
    });
  }

  const sandboxes = await db.db
    .collection("sandboxes")
    .find(
      {},
      {
        limit,
        skip: (Number.parseInt(page, 10) - 1) * limit,
        sort: {
          lastModified: -1,
        },
      }
    )
    .toArray();

  const sections = ["/items", "/offers", "/assets", "/achievements"];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${sandboxes
      .map((sandbox) => {
        const url = `https://egdata.app/sandboxes/${sandbox._id}`;
        return `<url>
            <loc>${url}</loc>
            <lastmod>${(sandbox.updated as Date).toISOString()}</lastmod>
            </url>
            ${sections
              .map(
                (section) => `
            <url>
              <loc>${url}${section}</loc>
              <lastmod>${(sandbox.updated as Date).toISOString()}</lastmod>
            </url>
            `
              )
              .join("\n")}
            `;
      })
      .join("\n")}
  </urlset>`;

  return c.text(sitemap, 200, {
    "Content-Type": "application/xml",
  });
});

app.get("/:sandboxId", async (c) => {
  const { sandboxId } = c.req.param();
  const cacheKey = `sandbox:${sandboxId}:v0.1`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  await client.set(cacheKey, JSON.stringify(sandbox), "EX", 3600);
  return c.json(sandbox);
});

app.get("/:sandboxId/items", async (ctx) => {
  const { sandboxId } = ctx.req.param();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(
    Number.parseInt(ctx.req.query("limit") || "10", 10),
    100
  );
  const skip = (page - 1) * limit;

  const { entitlementType, status, platforms, title } = ctx.req.query();

  const cacheKey = `sandbox:${sandboxId}:items:${page}:${limit}:${entitlementType}:${status}:${platforms}:${title}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return ctx.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    ctx.status(404);
    return ctx.json({
      message: "Sandbox not found",
    });
  }

  const query: RootFilterQuery<typeof Item> = {
    namespace: sandboxId,
  };

  // All the filters are comma separated arrays
  if (entitlementType) {
    query.entitlementType = { $in: entitlementType.split(",") };
  }

  if (status) {
    query.status = { $in: status.split(",") };
  }

  if (platforms) {
    query.releaseInfo = {
      $elemMatch: {
        platform: { $in: platforms.split(",") },
      },
    };
  }

  if (title) {
    query.title = { $regex: title, $options: "i" };
  }

  const [items, count] = await Promise.all([
    Item.find(query, undefined, {
      sort: {
        lastModified: -1,
      },
      skip,
      limit,
    }),
    Item.countDocuments(query),
  ]);

  const response = {
    elements: items,
    page,
    limit,
    count,
  };

  await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

  return ctx.json(response, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:sandboxId/offers", async (ctx) => {
  const { sandboxId } = ctx.req.param();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(
    Number.parseInt(ctx.req.query("limit") || "10", 10),
    100
  );
  const skip = (page - 1) * limit;

  const { offerType, title } = ctx.req.query();

  const cacheKey = `sandbox:${sandboxId}:offers:${page}:${limit}:${offerType}:${title}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return ctx.json(JSON.parse(cached));
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    ctx.status(404);
    return ctx.json({
      message: "Sandbox not found",
    });
  }

  const query: RootFilterQuery<typeof Offer> = {
    namespace: sandboxId,
  };

  if (offerType) {
    query.offerType = { $in: offerType.split(",") };
  }

  if (title) {
    query.title = { $regex: title, $options: "i" };
  }

  const [offers, count] = await Promise.all([
    Offer.find(query, undefined, {
      sort: {
        lastModified: -1,
      },
      skip,
      limit,
    }),
    Offer.countDocuments(query),
  ]);

  const response = {
    elements: offers,
    page,
    limit,
    count,
  };

  await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

  return ctx.json(response);
});

app.get("/:sandboxId/assets", async (ctx) => {
  const { sandboxId } = ctx.req.param();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(
    Number.parseInt(ctx.req.query("limit") || "10", 10),
    100
  );
  const skip = (page - 1) * limit;

  const { platform } = ctx.req.query();

  const cacheKey = `sandbox:${sandboxId}:assets:${page}:${limit}:${platform}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return ctx.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    ctx.status(404);
    return ctx.json({
      message: "Sandbox not found",
    });
  }

  try {
    // Get all items with their releaseInfo
    const items = await Item.find(
      { namespace: sandboxId },
      { id: 1, namespace: 1, releaseInfo: 1, title: 1 }
    ).lean();

    // Get all real assets
    const [realAssets, realAssetCount] = await Promise.all([
      Asset.find({ namespace: sandboxId }, undefined, {
        sort: { updatedAt: -1 },
      }).lean(),
      Asset.countDocuments({ namespace: sandboxId }),
    ]);

    // Create a map of real assets for quick lookup
    const realAssetsMap = new Map(realAssets.map((a) => [a.artifactId, a]));

    // Generate virtual assets from items' releaseInfo
    const virtualAssets = items.flatMap((item) =>
      item.releaseInfo.flatMap((releaseInfo) => {
        if (realAssetsMap.has(releaseInfo.appId as string)) return [];

        return releaseInfo.platform.map(
          (platform) =>
            ({
              artifactId: releaseInfo.appId as string,
              downloadSizeBytes: 0,
              installedSizeBytes: 0,
              itemId: item.id,
              namespace: item.namespace,
              platform,
              _id: new ObjectId(),
              title: item.title,
              __v: 0,
              updatedAt: new Date(0),
            } as typeof Asset.prototype)
        );
      })
    );

    // Combine and sort all assets
    const allAssets = [...realAssets, ...virtualAssets].sort((a, b) => {
      const dateA = a.updatedAt || new Date(0);
      const dateB = b.updatedAt || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });

    // Apply platform filter if specified
    const filteredAssets = platform
      ? allAssets.filter((asset) =>
          platform.split(",").includes(asset.platform)
        )
      : allAssets;

    // Apply pagination
    const paginatedAssets = filteredAssets.slice(skip, skip + limit);

    const response = {
      elements: paginatedAssets,
      page,
      limit,
      count: filteredAssets.length,
    };

    await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

    return ctx.json(response, 200, {
      "Cache-Control": "public, max-age=60",
    });
  } catch (error) {
    console.error("Error in assets endpoint:", error);
    ctx.status(500);
    return ctx.json({
      message: "Internal server error",
    });
  }
});

app.get("/:sandboxId/base-game", async (c) => {
  const { sandboxId } = c.req.param();
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

  const cacheKey = `base-game:${sandboxId}:${region}:v0.1`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);

    return c.json({
      message: "Sandbox not found",
    });
  }

  let baseGame = await Offer.findOne({
    namespace: sandboxId,
    offerType: "BASE_GAME",
    prePurchase: { $ne: true },
    isCodeRedemptionOnly: false,
  });

  if (!baseGame) {
    // If no game found, try to find a pre-purchase game
    const prePurchaseGame = await Offer.findOne({
      namespace: sandboxId,
      offerType: "BASE_GAME",
      prePurchase: true,
    });

    if (prePurchaseGame) {
      baseGame = prePurchaseGame;
    } else {
      // Try to find an "EXECUTABLE" item, with at least one asset
      const executableGame = await Item.findOne({
        namespace: sandboxId,
        entitlementType: "EXECUTABLE",
        "releaseInfo.0": { $exists: true },
      });

      if (executableGame) {
        const response = {
          ...executableGame.toObject(),
          isItem: true,
        };
        await client.set(cacheKey, JSON.stringify(response), "EX", 3600);
        return c.json(response);
      }

      c.status(404);

      return c.json({
        message: "Base game not found",
      });
    }
  }

  const price = await PriceEngine.findOne({
    offerId: baseGame.id,
    region,
  });

  const response = {
    ...orderOffersObject(baseGame),
    price: price ?? null,
  };

  await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

  return c.json(response);
});

app.get("/:sandboxId/achievements", async (c) => {
  const { sandboxId } = c.req.param();
  const cacheKey = `sandbox:${sandboxId}:achievements:v0.1`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  const achievements = await AchievementSet.find({
    sandboxId: sandboxId,
  });

  await client.set(cacheKey, JSON.stringify(achievements), "EX", 3600);

  return c.json(achievements);
});

app.get("/:sandboxId/changelog", async (c) => {
  const { sandboxId } = c.req.param();
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10"), 50);
  const page = Math.max(Number.parseInt(c.req.query("page") || "1"), 1);
  const skip = (page - 1) * limit;
  const cacheKey = `changelog:${sandboxId}:${page}:${limit}`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
    });
  }

  const start = performance.now();
  try {
    // Get the sandbox
    const sandbox = await db.db.collection("sandboxes").findOne({
      // @ts-expect-error
      _id: sandboxId,
    });

    if (!sandbox) {
      return c.json({ error: "Sandbox not found" }, 404);
    }

    // Get all offers with the same namespace
    const offers = await db.db
      .collection("offers")
      .find({
        namespace: sandboxId,
      })
      .sort({ lastModifiedDate: -1 })
      .limit(100)
      .toArray();

    // Get all items from the offers
    const items = await Item.find(
      {
        $or: [
          {
            id: {
              $in: offers.flatMap((o) =>
                o.items.map((i: { id: string }) => i.id)
              ),
            },
          },
          { namespace: sandboxId },
        ],
      },
      {
        id: 1,
        namespace: 1,
        releaseInfo: 1,
      },
      {
        lean: true,
        sort: {
          lastModifiedDate: -1,
        },
        limit: 100,
      }
    );

    // Get all assets from the items
    const assets = await Asset.find({
      itemId: { $in: items.map((i) => i.id) },
    });

    // Get all builds from item releaseInfo appIds
    const builds = await db.db
      .collection("builds")
      .find({
        appName: {
          $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
        },
      })
      .toArray();

    const allIds = [
      sandboxId,
      ...offers.map((o) => o.id),
      ...items.map((i: { id: string }) => i.id),
      ...assets.map((a) => a.artifactId),
      ...builds.map((b) => b._id.toString()),
    ];

    // Use aggregation pipeline for better performance
    const changelog = await db.db
      .collection("changelogs_v2")
      .aggregate([
        {
          $match: {
            "metadata.contextId": { $in: allIds },
          },
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
          $lookup: {
            from: "builds",
            let: { contextId: "$metadata.contextId" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$contextId"] },
                },
              },
            ],
            as: "buildDoc",
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
                  {
                    case: { $eq: ["$metadata.contextType", "build"] },
                    then: { $arrayElemAt: ["$buildDoc", 0] },
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

    const estimatedTotalHits = await db.db
      .collection("changelogs_v2")
      .countDocuments({ "metadata.contextId": { $in: allIds } });

    // Cache the results
    await client.set(
      cacheKey,
      JSON.stringify({
        hits: changelog,
        estimatedTotalHits,
        limit,
        offset: skip,
      }),
      "EX",
      60
    );

    consola.log(`changelog ${sandboxId} in ${performance.now() - start} ms`);
    return c.json(
      {
        hits: changelog,
        estimatedTotalHits,
        limit,
        offset: skip,
      },
      200,
      {
        "Cache-Control": "public, max-age=60",
      }
    );
  } catch (err) {
    console.error("Error in changelog endpoint:", err);
    return c.json({ message: "Internal server error" }, 500);
  }
});

app.get("/:sandboxId/builds", async (c) => {
  const { sandboxId } = c.req.param();
  const page = Number.parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(
    Number.parseInt(c.req.query("limit") || "10", 10),
    100
  );
  const skip = (page - 1) * limit;

  const { platform } = c.req.query();

  const cacheKey = `sandbox:${sandboxId}:builds:${page}:${limit}:${platform}`;
  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  const query: RootFilterQuery<typeof Item> = {
    namespace: sandboxId,
  };

  if (platform) {
    query.releaseInfo = {
      $elemMatch: { platform: { $in: platform.split(",") } },
    };
  }

  // First get all items to get the appIds
  const items = await Item.find(query, {
    releaseInfo: 1,
  });

  const appIds = items.flatMap((i) => i.releaseInfo.map((r) => r.appId));

  // Get all builds for these appIds
  const [builds, count] = await Promise.all([
    db.db
      .collection("builds")
      .find({
        appName: {
          $in: appIds,
        },
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.db.collection("builds").countDocuments({
      appName: {
        $in: appIds,
      },
    }),
  ]);

  const response = {
    elements: builds,
    page,
    limit,
    count,
  };

  await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

  return c.json(response);
});

app.get("/:sandboxId/stats", async (c) => {
  const { sandboxId } = c.req.param();
  const cacheKey = `sandbox:${sandboxId}:stats:v0.1`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const sandbox = await db.db.collection("sandboxes").findOne({
    // @ts-ignore
    _id: sandboxId,
  });

  if (!sandbox) {
    c.status(404);
    return c.json({
      message: "Sandbox not found",
    });
  }

  const [offers, items, achievements, assets] = await Promise.all([
    Offer.countDocuments({
      namespace: sandboxId,
    }),
    Item.find({
      namespace: sandboxId,
    }),
    AchievementSet.find({
      sandboxId,
    }),
    Asset.find({
      namespace: sandboxId,
    }),
  ]);

  // Create a map of all assets by artifactId for quick lookup
  const assetsMap = new Map(assets.map((a) => [a.artifactId, a]));

  // Count virtual assets (those that exist in releaseInfo but don't have a corresponding asset)
  let virtualAssetsCount = 0;
  for (const item of items) {
    for (const releaseInfo of item.releaseInfo) {
      if (!assetsMap.has(releaseInfo.appId as string)) {
        virtualAssetsCount += releaseInfo.platform.length;
      }
    }
  }

  const [builds] = await Promise.all([
    db.db
      .collection("builds")
      .find({
        appName: {
          $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
        },
      })
      .toArray(),
  ]);

  const response = {
    offers,
    items: items.length,
    assets: assets.length + virtualAssetsCount,
    builds: builds.length,
    achievements: achievements.flatMap((a) => a.achievements).length,
  };

  await client.set(cacheKey, JSON.stringify(response), "EX", 3600);

  return c.json(response);
});

export default app;
