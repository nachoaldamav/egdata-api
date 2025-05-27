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

const app = new Hono();

app.get("/", async (ctx) => {
  const start = Date.now();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(
    Number.parseInt(ctx.req.query("limit") || "10", 10),
    100
  );
  const skip = (page - 1) * limit;

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

  return ctx.json(
    {
      elements: sandboxes,
      page,
      limit,
      count,
    },
    200,
    {
      "Server-Timing": `db;dur=${Date.now() - start}`,
    }
  );
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
        `<sitemap><loc>https://eu.api.egdata.app/sandboxes/sitemap.xml?page=${i + 1
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

  return c.json(sandbox);
});

app.get("/:sandboxId/items", async (ctx) => {
  const { sandboxId } = ctx.req.param();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(Number.parseInt(ctx.req.query("limit") || "10", 10), 100);
  const skip = (page - 1) * limit;

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

  const [items, count] = await Promise.all([
    Item.find(
      {
        namespace: sandboxId,
      },
      undefined,
      {
        sort: {
          lastModified: -1,
        },
        skip,
        limit,
      }
    ),
    Item.countDocuments({
      namespace: sandboxId,
    }),
  ]);

  return ctx.json({
    elements: items,
    page,
    limit,
    count,
  }, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:sandboxId/offers", async (ctx) => {
  const { sandboxId } = ctx.req.param();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(Number.parseInt(ctx.req.query("limit") || "10", 10), 100);
  const skip = (page - 1) * limit;

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

  const [offers, count] = await Promise.all([
    Offer.find(
      {
        namespace: sandboxId,
      },
      undefined,
      {
        sort: {
          lastModified: -1,
        },
        skip,
        limit,
      }
    ),
    Offer.countDocuments({
      namespace: sandboxId,
    }),
  ]);

  return ctx.json({
    elements: offers,
    page,
    limit,
    count,
  });
});

app.get("/:sandboxId/assets", async (ctx) => {
  const { sandboxId } = ctx.req.param();
  const page = Number.parseInt(ctx.req.query("page") || "1", 10);
  const limit = Math.min(Number.parseInt(ctx.req.query("limit") || "10", 10), 100);
  const skip = (page - 1) * limit;

  const cacheKey = `${sandboxId}-assets-${page}-${limit}`;

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

  const [assets, items, count] = await Promise.all([
    Asset.find(
      {
        namespace: sandboxId,
      },
      undefined,
      {
        sort: {
          lastModified: -1,
        },
        skip,
        limit,
      }
    ),
    Item.find(
      {
        namespace: sandboxId,
      },
      {
        id: 1,
        namespace: 1,
        releaseInfo: 1,
        title: 1,
      }
    ),
    Asset.countDocuments({
      namespace: sandboxId,
    }),
  ]);

  const result = assets.map((a) => {
    const item = items.find((i) => i.id === a.itemId);
    return {
      ...a.toObject(),
      title: item?.title,
    };
  });

  // Some assets are not found because they are protected or hidden, but we know they exist, so we add them to the result with 0 sizes
  for (const item of items) {
    for (const releaseInfo of item.releaseInfo) {
      if (!assets.find((a) => a.artifactId === releaseInfo.appId)) {
        for (const platform of releaseInfo.platform) {
          result.push({
            artifactId: releaseInfo.appId as string,
            downloadSizeBytes: 0,
            installedSizeBytes: 0,
            itemId: item.id,
            namespace: item.namespace,
            platform,
            _id: new ObjectId(),
            title: item.title,
            __v: 0,
          });
        }
      }
    }
  }

  const response = {
    elements: result,
    page,
    limit,
    count,
  };

  await client.set(cacheKey, JSON.stringify(response), 'EX', 3600);

  return ctx.json(response);
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

  const cacheKey = `base-game:${sandboxId}:${region}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
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
        return c.json({
          ...executableGame.toObject(),
          isItem: true,
        });
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

  const offer = {
    ...orderOffersObject(baseGame),
    price: price ?? null,
  };

  await client.set(cacheKey, JSON.stringify(offer), 'EX', 3600);

  return c.json(offer);
});

app.get("/:sandboxId/achievements", async (c) => {
  const { sandboxId } = c.req.param();

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

  return c.json(achievements);
});

app.get("/:sandboxId/changelog", async (c) => {
  const { sandboxId } = c.req.param();
  const limit = c.req.query("limit") || "30";
  const page = c.req.query("page") || "1";

  const skip = (Number.parseInt(page, 10) - 1) * Number.parseInt(limit, 10);

  const cacheKey = `changelog:${sandboxId}:${skip}:${limit}`;

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

  const [offers, items, assets] = await Promise.all([
    Offer.find({
      namespace: sandboxId,
    }),
    Item.find({
      namespace: sandboxId,
    }),
    Asset.find({
      namespace: sandboxId,
    }),
  ]);

  const builds = await db.db
    .collection("builds")
    .find({
      appName: {
        $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
      },
    })
    .toArray();

  const [offersIds, itemsIds, assetsIds, buildsIds] = await Promise.all([
    offers.map((o) => o.id),
    items.map((i) => i.id),
    assets.map((a) => a.artifactId),
    builds.map((b) => b._id),
  ]);

  const changelist = await Changelog.find(
    {
      "metadata.contextId": {
        $in: [...offersIds, ...itemsIds, ...assetsIds, ...buildsIds, sandboxId],
      },
    },
    undefined,
    {
      sort: {
        timestamp: -1,
      },
      limit: Number.parseInt(limit, 10),
      skip,
    }
  );

  const count = await Changelog.countDocuments({
    "metadata.contextId": {
      $in: [...offersIds, ...itemsIds, ...assetsIds, ...buildsIds, sandboxId],
    },
  });

  const result = {
    hits: await Promise.all(
      changelist
        .map((c) => c.toJSON())
        .map(async (c) => {
          const type = c.metadata.contextType;
          const id = c.metadata.contextId;

          if (type === "offer") {
            c.document = await Offer.findOne({ id });
          }

          if (type === "item") {
            c.document = await Item.findOne({
              id,
            });
          }

          if (type === "asset") {
            const asset = await Asset.findOne({
              artifactId: id,
            });

            c.document = await Item.findOne({
              id: asset?.itemId,
            });
          }

          if (type === "build") {
            const build = await db.db.collection("builds").findOne({
              _id: new ObjectId(id),
            });

            c.document = build;
          }

          return c;
        })
    ),
    estimatedTotalHits: count,
    limit: Number.parseInt(limit, 10),
    offset: skip,
  };

  await client.set(cacheKey, JSON.stringify(result), 'EX', 3600);

  return c.json(result);
});

app.get("/:sandboxId/builds", async (c) => {
  const { sandboxId } = c.req.param();
  const page = Number.parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(Number.parseInt(c.req.query("limit") || "10", 10), 100);
  const skip = (page - 1) * limit;

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

  const items = await Item.find({
    namespace: sandboxId,
  });

  const [builds, count] = await Promise.all([
    db.db
      .collection("builds")
      .find({
        appName: {
          $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
        },
      })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.db
      .collection("builds")
      .countDocuments({
        appName: {
          $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
        },
      }),
  ]);

  return c.json({
    elements: builds,
    page,
    limit,
    count,
  });
});

app.get("/:sandboxId/stats", async (c) => {
  const { sandboxId } = c.req.param();

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

  const [offers, items, achievements] = await Promise.all([
    Offer.countDocuments({
      namespace: sandboxId,
    }),
    Item.find({
      namespace: sandboxId,
    }),
    AchievementSet.find({
      sandboxId,
    }),
  ]);

  const [assets, builds] = await Promise.all([
    Asset.countDocuments({
      namespace: sandboxId,
    }),
    db.db
      .collection("builds")
      .find({
        appName: {
          $in: items.flatMap((i) => i.releaseInfo.map((r) => r.appId)),
        },
      })
      .toArray(),
  ]);

  return c.json({
    offers,
    items: items.length,
    assets,
    builds: builds.length,
    achievements: achievements.flatMap((a) => a.achievements).length,
  });
});

export default app;
