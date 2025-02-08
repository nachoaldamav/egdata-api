import { Hono } from "hono";
import { epicStoreClient } from "../clients/epic.js";
import client from "../clients/redis.js";
import type { AchievementsSummary } from "../types/get-user-achievements.js";
import { db } from "../db/index.js";
import { Sandbox } from "@egdata/core.schemas.sandboxes";
import { Offer } from "@egdata/core.schemas.offers";
import { AchievementSet } from "@egdata/core.schemas.achievements";
import type { WithId } from "mongodb";
import type { AnyObject } from "mongoose";
import { auth } from "../utils/auth.js";

export interface PlayerProductAchievements {
  _id: Id;
  epicAccountId: string;
  sandboxId: string;
  totalXP: number;
  totalUnlocked: number;
  achievementSets: IAchievementSet[];
  playerAwards: PlayerAward[];
  playerAchievements: PlayerAchievement[];
}

interface Id {
  $oid: string;
}

interface IAchievementSet {
  achievementSetId: string;
  isBase: boolean;
  totalUnlocked: number;
  totalXP: number;
}

interface PlayerAward {
  awardType: string;
  unlockedDateTime: string;
  achievementSetId: string;
}

interface PlayerAchievement {
  playerAchievement: PlayerAchievement2;
}

interface PlayerAchievement2 {
  achievementName: string;
  epicAccountId: string;
  progress: number;
  sandboxId: string;
  unlocked: boolean;
  unlockDate: string;
  XP: number;
  achievementSetId: string;
  isBase: boolean;
}

type SingleAchievement = {
  playerAwards: PlayerAward[];
  totalXP: number;
  totalUnlocked: number;
  sandboxId: string;
  baseOfferForSandbox: {
    id: string;
    namespace: string;
    keyImages: unknown[];
  };
  product: {
    name: string;
    slug: string;
  };
  productAchievements: {
    totalAchievements: number;
    totalProductXP: number;
  };
};

const app = new Hono();

app.get("/sitemap.xml", async (c) => {
  const profiles = await db.db.collection("epic").find({}).toArray();

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${profiles
    .map(
      (profile) =>
        `<url>
          <loc>https://egdata.app/profile/${profile.accountId}</loc>
        </url>`,
    )
    .join("\n")}
</urlset>`;

  return c.text(sitemap, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
});

app.get("/me", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    c.status(401);
    return c.json({
      message: "Unauthorized",
    });
  }

  const { user } = session;

  const { email } = user;

  const id = email.split("@")[0];

  const profile = await epicStoreClient.getUser(id);
  const dbProfile = await db.db.collection("epic").findOne({
    accountId: id,
  });

  if (dbProfile && !dbProfile.creationDate) {
    dbProfile.creationDate = new Date();
    await db.db.collection("epic").updateOne(
      {
        accountId: id,
      },
      {
        $set: {
          creationDate: dbProfile.creationDate,
        },
      },
    );
  }

  if (!profile) {
    c.status(404);
    return c.json({
      message: "Profile not found",
    });
  }

  const result = {
    ...profile,
    avatar: {
      small: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.small,
      medium: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.medium,
      large: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.large,
    },
    linkedAccounts: dbProfile?.linkedAccounts,
    creationDate: dbProfile?.creationDate,
  };

  return c.json(result, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
});

app.get("/:id", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:v0.3`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  try {
    const profile = await epicStoreClient.getUser(id);
    const dbProfile = await db.db.collection("epic").findOne({
      accountId: id,
    });

    if (dbProfile && !dbProfile.creationDate) {
      dbProfile.creationDate = new Date();
      await db.db.collection("epic").updateOne(
        {
          accountId: id,
        },
        {
          $set: {
            creationDate: dbProfile.creationDate,
          },
        },
      );
    }

    const reviewsCount = await db.db
      .collection("reviews")
      .countDocuments({ userId: id });

    if (!profile) {
      c.status(404);
      return c.json({
        message: "Profile not found",
      });
    }

    const savedPlayerAchievements = await db.db
      .collection("player-achievements")
      .find<PlayerProductAchievements>({ epicAccountId: id })
      .toArray();

    if (savedPlayerAchievements) {
      const achievements: AchievementsSummary[] = [];

      await Promise.all(
        savedPlayerAchievements.map(async (entry) => {
          const sandbox = await Sandbox.findOne({ _id: entry.sandboxId });

          if (!sandbox) {
            console.error("Sandbox not found", entry.sandboxId);
            return;
          }

          const [product, offer, achievementsSets] = await Promise.all([
            db.db
              .collection("products")
              .findOne({ _id: sandbox?.parent as unknown as Id }),
            Offer.findOne({
              namespace: entry.sandboxId,
              offerType: "BASE_GAME",
            }),
            AchievementSet.find({
              sandboxId: entry.sandboxId,
            }),
          ]);

          if (!product || !offer) {
            return;
          }

          achievements.push({
            __typename: "AchievementsSummaryResponseSuccess",
            status: "200",
            data: {
              playerAwards: entry.playerAwards,
              totalXP: entry.totalXP,
              totalUnlocked: entry.totalUnlocked,
              sandboxId: entry.sandboxId,
              baseOfferForSandbox: {
                id: offer.id,
                namespace: offer.namespace,
                keyImages: offer.keyImages as any,
              },
              product: {
                name: offer.title,
                slug: offer.productSlug as string,
              },
              productAchievements: {
                totalAchievements: achievementsSets.reduce(
                  (acc, curr) => acc + curr.achievements.length,
                  0,
                ),
                totalProductXP: achievementsSets.reduce(
                  (acc, curr) =>
                    acc +
                    curr.achievements.reduce((acc, curr) => acc + curr.xp, 0),
                  0,
                ),
              },
            },
          });
        }),
      );

      const result = {
        ...profile,
        achievements: {
          __typename: "AchievementsSummaryResponse",
          status: 200,
          data: achievements.map((achievement) => achievement.data),
        },
        avatar: {
          small: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.small,
          medium: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.medium,
          large: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.large,
        },
        linkedAccounts: dbProfile?.linkedAccounts,
        creationDate: dbProfile?.creationDate,
        reviews: reviewsCount,
      };

      await client.set(cacheKey, JSON.stringify(result), {
        EX: 60,
      });

      return c.json(result, {
        headers: {
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    const achievements = await epicStoreClient.getUserAchievements(id);

    const result = {
      ...profile,
      achievements,
      avatar: {
        small: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.small,
        medium: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.medium,
        large: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.large,
      },
      linkedAccounts: dbProfile?.linkedAccounts,
      creationDate: dbProfile?.creationDate,
      reviews: reviewsCount,
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 3600,
    });

    return c.json(result, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("Error fetching profile", err);
    c.status(400);
    return c.json({
      message: "Failed to fetch profile",
    });
  }
});

app.get("/:id/achievements/:sandboxId", async (c) => {
  const { id, sandboxId } = c.req.param();

  if (!id || !sandboxId) {
    c.status(400);
    return c.json({
      message: "Missing id or sandboxId parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:${sandboxId}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const playerAchievements = await db.db
    .collection("player-achievements")
    .find<PlayerProductAchievements>({
      epicAccountId: id,
      sandboxId: sandboxId,
    })
    .toArray();

  const achievementsSets = playerAchievements.flatMap((p) =>
    p.achievementSets.map((a) => a.achievementSetId),
  );

  const dedupedAchievementsSets = [...new Set(achievementsSets)];

  const sandboxAchievements = await AchievementSet.find({
    achievementSetId: {
      $in: dedupedAchievementsSets,
    },
  });

  return c.json({
    playerAchievements,
    sandboxAchievements,
  });
});

app.get("/:id/rare-achievements", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:rare-achievements`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  // Get all the achievements for the player
  const playerAchievements = await db.db
    .collection("player-achievements")
    .find<PlayerProductAchievements>({
      epicAccountId: id,
    })
    .toArray();

  const achievementsSetsIds = playerAchievements.flatMap((p) =>
    p.achievementSets.map((a) => a.achievementSetId),
  );

  const dedupedAchievementsSets = [...new Set(achievementsSetsIds)];

  const sandboxAchievements = await AchievementSet.find({
    achievementSetId: {
      $in: dedupedAchievementsSets,
    },
  });

  // Extract, inject achievementSetId and sandboxId, and flatten all achievements
  const allAchievements = sandboxAchievements.flatMap((set) =>
    set.achievements.map((achievement) => ({
      ...achievement.toObject(),
      achievementSetId: set.achievementSetId, // Inject achievementSetId
      sandboxId: set.sandboxId, // Inject sandboxId
    })),
  );

  // Sort by rarity (completedPercent)
  const sortedAchievements = allAchievements.sort(
    (a, b) => a.completedPercent - b.completedPercent,
  );

  const allPlayerAchievements = playerAchievements.flatMap(
    (p) => p.playerAchievements,
  );

  const result: (AchievementType & {
    unlocked: boolean;
    unlockDate: string;
    sandboxId: string; // Include sandboxId type in the result
  })[] = [];

  for (const achievement of sortedAchievements) {
    const playerAchievement = allPlayerAchievements.find(
      (p) =>
        p.playerAchievement.achievementName === achievement.name &&
        p.playerAchievement.achievementSetId === achievement.achievementSetId,
    );

    if (!playerAchievement) {
      continue;
    }

    result.push({
      ...achievement,
      unlocked: playerAchievement.playerAchievement.unlocked,
      unlockDate: playerAchievement.playerAchievement.unlockDate,
    });
  }

  const response = result.filter((a) => a.unlocked).slice(0, 25);

  const offers = await Offer.find({
    namespace: {
      $in: response.map((r) => r.sandboxId),
    },
    offerType: ["BASE_GAME", "DLC"],
    prePurchase: { $ne: true },
  });

  const selectedAchievements = response.map((r) => {
    const offer = offers
      .sort((a, b) => (a.offerType === "BASE_GAME" ? -1 : 1))
      .find((o) => o.namespace === r.sandboxId);
    return {
      ...r,
      offer: offer ?? null,
    };
  });

  await client.set(cacheKey, JSON.stringify(selectedAchievements), {
    EX: 3600,
  });

  return c.json(selectedAchievements, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
});

app.get("/:id/rare-achievements/:sandboxId", async (c) => {
  const { id, sandboxId } = c.req.param();

  if (!id || !sandboxId) {
    c.status(400);
    return c.json({
      message: "Missing id or sandboxId parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:${sandboxId}:rare-achievements:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  // Get all the achievements for the player
  const playerAchievements = await db.db
    .collection("player-achievements")
    .find<PlayerProductAchievements>({
      epicAccountId: id,
      sandboxId: sandboxId,
    })
    .toArray();

  const achievementsSetsIds = playerAchievements.flatMap((p) =>
    p.achievementSets.map((a) => a.achievementSetId),
  );

  const dedupedAchievementsSets = [...new Set(achievementsSetsIds)];

  const sandboxAchievements = await AchievementSet.find({
    achievementSetId: {
      $in: dedupedAchievementsSets,
    },
  });

  // Extract, inject achievementSetId and sandboxId, and flatten all achievements
  const allAchievements = sandboxAchievements.flatMap((set) =>
    set.achievements.map((achievement) => ({
      ...achievement.toObject(),
      achievementSetId: set.achievementSetId, // Inject achievementSetId
      sandboxId: set.sandboxId, // Inject sandboxId
      unlocked: playerAchievements
        .find((p) =>
          p.playerAchievements.some(
            (pa) => pa.playerAchievement.achievementName === achievement.name,
          ),
        )
        ?.playerAchievements.find(
          (pa) => pa.playerAchievement.achievementName === achievement.name,
        )?.playerAchievement.unlocked,
      unlockDate: playerAchievements
        .find((p) =>
          p.playerAchievements.some(
            (pa) => pa.playerAchievement.achievementName === achievement.name,
          ),
        )
        ?.playerAchievements.find(
          (pa) => pa.playerAchievement.achievementName === achievement.name,
        )?.playerAchievement.unlockDate,
    })),
  );

  // Sort by rarity (completedPercent)
  const sortedAchievements = allAchievements
    .filter((a) => a.unlocked)
    .sort((a, b) => a.completedPercent - b.completedPercent);

  const selectedAchievements = sortedAchievements.slice(0, 3);

  await client.set(cacheKey, JSON.stringify(selectedAchievements), {
    EX: 3600,
  });

  return c.json(selectedAchievements, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
});

app.get("/:id/achievements", async (c) => {
  const { id } = c.req.param();
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "25"), 100);
  const page = Math.min(Number.parseInt(c.req.query("page") ?? "1"), 100);
  const skip = (page - 1) * limit;

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:achievements:${limit}:${page}:v0.3`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  const [playerUnlockedAchievements, count] = await Promise.all([
    db.db
      .collection("player-achievements")
      .aggregate([
        {
          $match: {
            epicAccountId: id,
          },
        },
        {
          $unwind: "$playerAchievements",
        },
        {
          $match: {
            "playerAchievements.playerAchievement.unlocked": true,
          },
        },
        {
          $addFields: {
            unlockDate: "$playerAchievements.playerAchievement.unlockDate",
          },
        },
        {
          $group: {
            _id: {
              achievementName:
                "$playerAchievements.playerAchievement.achievementName",
              sandboxId: "$playerAchievements.playerAchievement.sandboxId",
            },
            doc: {
              $first: "$$ROOT",
            },
            latestUnlockDate: { $max: "$unlockDate" },
          },
        },
        {
          $replaceRoot: {
            newRoot: "$doc",
          },
        },
        {
          $sort: {
            unlockDate: -1,
          },
        },
        {
          $lookup: {
            from: "achievementsets",
            let: {
              achievementName:
                "$playerAchievements.playerAchievement.achievementName",
              sandboxId: "$playerAchievements.playerAchievement.sandboxId",
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$sandboxId", "$$sandboxId"],
                  },
                },
              },
              {
                $unwind: "$achievements",
              },
              {
                $match: {
                  $expr: {
                    $eq: ["$achievements.name", "$$achievementName"],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  achievementDetails: "$achievements",
                },
              },
            ],
            as: "achievementDetails",
          },
        },
        {
          $unwind: {
            path: "$achievementDetails",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $project: {
            _id: 0,
            achievementName:
              "$playerAchievements.playerAchievement.achievementName",
            unlockDate: "$playerAchievements.playerAchievement.unlockDate",
            XP: "$playerAchievements.playerAchievement.XP",
            sandboxId: "$playerAchievements.playerAchievement.sandboxId",
            isBase: "$playerAchievements.playerAchievement.isBase",
            achievementDetails: "$achievementDetails.achievementDetails",
          },
        },
        { $skip: skip },
        { $limit: limit },
      ])
      .toArray(),
    db.db
      .collection("player-achievements")
      .aggregate([
        { $match: { epicAccountId: id } },
        { $unwind: "$playerAchievements" },
        { $match: { "playerAchievements.playerAchievement.unlocked": true } },
        {
          $group: {
            _id: {
              achievementName:
                "$playerAchievements.playerAchievement.achievementName",
              sandboxId: "$playerAchievements.playerAchievement.sandboxId",
            },
          },
        },
        { $count: "count" },
      ])
      .toArray(),
  ]);

  const offers = await Offer.find({
    namespace: {
      $in: playerUnlockedAchievements.map((r) => r.sandboxId),
    },
    offerType: ["BASE_GAME", "DLC"],
    prePurchase: { $ne: true },
  });

  const selectedAchievements = playerUnlockedAchievements.map((r) => {
    const offer = offers
      .sort((a, b) => (a.offerType === "BASE_GAME" ? -1 : 1))
      .find((o) => o.namespace === r.sandboxId);
    return {
      ...r.achievementDetails,
      unlocked: true,
      unlockDate: r.unlockDate,
      offer: offer ?? null,
    };
  });

  const result = {
    achievements: selectedAchievements,
    count: count?.[0]?.count ?? 0,
    limit,
    page,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
});

app.get("/:id/information", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:v0.3`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  try {
    // Fetch user profile from Epic Store client
    const profile = await epicStoreClient.getUser(id);

    if (!profile) {
      c.status(404);
      return c.json({
        message: "Profile not found",
      });
    }

    // Fetch user profile from the database
    const dbProfile = await db.db.collection("epic").findOne({
      accountId: id,
    });

    if (dbProfile && !dbProfile.creationDate) {
      dbProfile.creationDate = new Date();
      await db.db.collection("epic").updateOne(
        {
          accountId: id,
        },
        {
          $set: {
            creationDate: dbProfile.creationDate,
          },
        },
      );
    }

    // Manually calculate stats by iterating through achievements
    const playerAchievements = await db.db
      .collection("player-achievements")
      .find({ epicAccountId: id })
      .toArray();

    let totalGames = 0;
    let totalPlayerAwards = 0;
    let totalAchievements = 0;
    let totalXP = 0;

    const singleAchievementsLists: WithId<AnyObject>[] = [];

    for (const achievement of playerAchievements) {
      if (
        !singleAchievementsLists.find(
          (a) => a.sandboxId === achievement.sandboxId,
        )
      ) {
        singleAchievementsLists.push(achievement);
      }
    }

    for (const achievement of singleAchievementsLists) {
      totalGames += 1;
      totalPlayerAwards += achievement.playerAwards
        ? achievement.playerAwards.length
        : 0;
      totalAchievements += achievement.totalUnlocked || 0;
      totalXP += achievement.totalXP || 0;
    }

    // Calculate the total XP with additional points for each platinum award
    const calculatedXP = totalXP + totalPlayerAwards * 250;

    // Fetch reviews count
    const reviewsCount = await db.db
      .collection("reviews")
      .countDocuments({ userId: id });

    // Construct the result object
    const result = {
      ...profile,
      stats: {
        totalGames,
        totalAchievements,
        totalPlayerAwards,
        totalXP: calculatedXP,
        reviewsCount,
      },
      avatar: {
        small: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.small,
        medium: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.medium,
        large: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.large,
      },
      linkedAccounts: dbProfile?.linkedAccounts,
      creationDate: dbProfile?.creationDate,
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 60,
    });

    return c.json(result, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("Error fetching profile", err);
    c.status(400);
    return c.json({
      message: "Failed to fetch profile",
    });
  }
});

app.get("/:id/games", async (c) => {
  const { id } = c.req.param();
  const { page = "1", limit = "10" } = c.req.query();

  const pageNum = Number.parseInt(page, 10);
  const limitNum = Number.parseInt(limit, 10);

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const cacheKey = `epic-profile:${id}:games:page:${pageNum}:limit:${limitNum}`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  try {
    // Check if user exists
    const profile = await epicStoreClient.getUser(id);

    if (!profile) {
      c.status(404);
      return c.json({
        message: "Profile not found",
      });
    }

    // Fetch paginated achievements
    const savedPlayerAchievementsCursor = db.db
      .collection("player-achievements")
      .find({ epicAccountId: id })
      .sort({ totalXP: -1, _id: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    const savedPlayerAchievements =
      await savedPlayerAchievementsCursor.toArray();

    // Fetch total number of games for pagination
    const totalGames = await db.db
      .collection("player-achievements")
      .countDocuments({ epicAccountId: id });

    const achievements: SingleAchievement[] = [];

    if (savedPlayerAchievements && savedPlayerAchievements.length > 0) {
      await Promise.all(
        savedPlayerAchievements.map(async (entry) => {
          const sandbox = await Sandbox.findOne({ _id: entry.sandboxId });

          if (!sandbox) {
            console.error("Sandbox not found", entry.sandboxId);
            return;
          }

          const [product, offer, achievementsSets] = await Promise.all([
            db.db
              .collection("products")
              .findOne({ _id: sandbox?.parent as unknown as Id }),
            Offer.findOne({
              namespace: entry.sandboxId,
              offerType: "BASE_GAME",
            }),
            AchievementSet.find({
              sandboxId: entry.sandboxId,
            }),
          ]);

          if (!product || !offer) {
            return;
          }

          achievements.push({
            playerAwards: entry.playerAwards,
            totalXP: entry.totalXP,
            totalUnlocked: entry.totalUnlocked,
            sandboxId: entry.sandboxId,
            baseOfferForSandbox: {
              id: offer.id,
              namespace: offer.namespace,
              keyImages: offer.keyImages,
            },
            product: {
              name: offer.title,
              slug: offer.productSlug as string,
            },
            productAchievements: {
              totalAchievements: achievementsSets.reduce(
                (acc, curr) => acc + curr.achievements.length,
                0,
              ),
              totalProductXP: achievementsSets.reduce(
                (acc, curr) =>
                  acc +
                  curr.achievements.reduce((acc, curr) => acc + curr.xp, 0),
                0,
              ),
            },
          });
        }),
      );
    }

    // Deduplicate based on sandboxId after assembling achievements
    const deduplicatedAchievements = achievements.filter(
      (achievement, index, self) =>
        index === self.findIndex((t) => t.sandboxId === achievement.sandboxId),
    );

    // Construct the result object
    const result = {
      achievements: deduplicatedAchievements,
      pagination: {
        total: totalGames,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalGames / limitNum),
      },
    };

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 60,
    });

    return c.json(result, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("Error fetching achievements", err);
    c.status(400);
    return c.json({
      message: "Failed to fetch achievements",
    });
  }
});

app.get("/:id/random-game", async (c) => {
  const { id } = c.req.param();
  const { sandbox } = c.req.query();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  // Update the cache key to include the sandbox if provided
  const cacheKey = `epic-profile:${id}:random-game:${sandbox || "random"}`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  try {
    // Check if user exists
    const profile = await epicStoreClient.getUser(id);

    if (!profile) {
      c.status(404);
      return c.json({
        message: "Profile not found",
      });
    }

    let savedPlayerAchievement;

    if (sandbox) {
      // Override random logic: fetch the achievement for the provided sandbox
      savedPlayerAchievement = await db.db
        .collection("player-achievements")
        .findOne({ epicAccountId: id, sandboxId: sandbox });
    } else {
      // Fetch a random achievement
      const totalAchievements = await db.db
        .collection("player-achievements")
        .countDocuments({ epicAccountId: id });

      if (totalAchievements === 0) {
        c.status(404);
        return c.json({
          message: "No achievements found for this user",
        });
      }

      const randomSkip = Math.floor(Math.random() * totalAchievements);

      const savedPlayerAchievements = await db.db
        .collection("player-achievements")
        .find({ epicAccountId: id })
        .skip(randomSkip)
        .limit(1)
        .toArray();

      savedPlayerAchievement = savedPlayerAchievements[0];
    }

    if (!savedPlayerAchievement) {
      c.status(404);
      return c.json({
        message: "No achievements found for this user in the specified sandbox",
      });
    }

    // Fetch the sandbox data
    const sandboxData = await Sandbox.findOne({
      _id: savedPlayerAchievement.sandboxId,
    });

    if (!sandboxData) {
      console.error("Sandbox not found", savedPlayerAchievement.sandboxId);
      c.status(404);
      return c.json({
        message: "Sandbox not found",
      });
    }

    // Fetch the offer
    const offer = await Offer.findOne({
      namespace: savedPlayerAchievement.sandboxId,
      offerType: "BASE_GAME",
    });

    if (!offer) {
      c.status(404);
      return c.json({
        message: "Offer not found",
      });
    }

    // Construct the result object
    const result = offer;

    await client.set(cacheKey, JSON.stringify(result), {
      EX: 360,
    });

    return c.json(result, {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error("Error fetching offer", err);
    c.status(400);
    return c.json({
      message: "Failed to fetch offer",
    });
  }
});

export default app;
