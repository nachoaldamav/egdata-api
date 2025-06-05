import { Hono } from "hono";
import { epicStoreClient } from "../clients/epic.js";
import client, { ioredis } from "../clients/redis.js";
import type { AchievementsSummary } from "../types/get-user-achievements.js";
import { db } from "../db/index.js";
import { Sandbox } from "@egdata/core.schemas.sandboxes";
import { Offer } from "@egdata/core.schemas.offers";
import { AchievementSet } from "@egdata/core.schemas.achievements";
import { auth } from "../utils/auth.js";
import { Queue } from "bullmq";
import consola from "consola";

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

type AchievementType = {
  achievementSetId: string;
  sandboxId: string;
  unlocked?: boolean;
  unlockDate?: string;
  deploymentId: string;
  name: string;
  hidden: boolean;
  xp: number;
  completedPercent: number;
};

interface SingleAchievement {
  playerAwards: unknown[];
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
  completionPercentage: number;
}

type RegenOfferQueueType = {
  accountId: string;
};

const refreshAchievementsQueue = new Queue<RegenOfferQueueType>(
  "refreshAchievementsQueue",
  {
    connection: ioredis,
  }
);

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
        </url>`
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

  const cacheKey = `epic-me:${id}`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    });
  }

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
      }
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

  await client.set(cacheKey, JSON.stringify(result), "EX", 60);

  return c.json(result, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
});

app.get("/leaderboard", async (c) => {
  const pipeline = [
    /* 1️⃣  keep only what we need --------------------------------------- */
    {
      $project: {
        epicAccountId: 1,
        sandboxId: 1,
        totalXP: 1,
        totalUnlocked: 1,
        playerAwards: 1, //  ← NEW
      },
    },

    /* 2️⃣  one row / player + sandbox, max XP/achievements, **union awards** */
    {
      $group: {
        _id: { player: "$epicAccountId", sandbox: "$sandboxId" },

        xpForSandbox: { $max: "$totalXP" },
        unlockedForSandbox: { $max: "$totalUnlocked" },

        /* pull together all award arrays that belonged to that sandbox */
        awardsForSandbox_arr: { $push: "$playerAwards" },
      },
    },
    /* flatten the nested arrays & dedupe inside the sandbox ------------- */
    {
      $addFields: {
        awardsForSandbox: {
          $reduce: {
            input: "$awardsForSandbox_arr",
            initialValue: [],
            in: { $setUnion: ["$$value", "$$this"] },
          },
        },
      },
    },
    { $project: { awardsForSandbox_arr: 0 } },

    /* 3️⃣  collapse to one row per player, summing XP & achievements ----- */
    {
      $group: {
        _id: "$_id.player",
        xpEarned: { $sum: "$xpForSandbox" },
        achievementsWon: { $sum: "$unlockedForSandbox" },

        /* combine all awards the player has, dedup across sandboxes */
        awards_arr: { $push: "$awardsForSandbox" },
      },
    },
    {
      $addFields: {
        /* 3-A  flatten + dedupe the player’s award list */
        awards: {
          $reduce: {
            input: "$awards_arr",
            initialValue: [],
            in: { $setUnion: ["$$value", "$$this"] },
          },
        },

        /* 3-B  convenient overall count */
        awardsEarned: {
          $size: {
            $reduce: {
              input: "$awards_arr",
              initialValue: [],
              in: { $setUnion: ["$$value", "$$this"] },
            },
          },
        },
      },
    },
    { $project: { awards_arr: 0 } },

    /* 3-C  count awards per type (requires Mongo 5.2 +) ----------------- */
    {
      $addFields: {
        awardsByType: {
          $arrayToObject: {
            $map: {
              input: {
                $setUnion: {
                  $map: {
                    input: "$awards",
                    as: "a",
                    in: "$$a.awardType",
                  },
                },
              },
              as: "type",
              in: {
                k: "$$type",
                v: {
                  $size: {
                    $filter: {
                      input: "$awards",
                      as: "a",
                      cond: { $eq: ["$$a.awardType", "$$type"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    /* 4️⃣  OPTIONAL  join player profile collection --------------------- */
    {
      $lookup: {
        from: "epic", // or whatever your accounts coll. is
        localField: "_id",
        foreignField: "accountId",
        as: "player",
      },
    },
    { $unwind: { path: "$player", preserveNullAndEmptyArrays: true } },

    /* 5️⃣  rank by XP ---------------------------------------------------- */
    {
      $setWindowFields: {
        sortBy: { xpEarned: -1 },
        output: { rank: { $rank: {} } },
      },
    },

    /* 6️⃣  final shape --------------------------------------------------- */
    {
      $project: {
        _id: 0,
        rank: 1,
        accountId: "$_id",
        displayName: "$player.displayName",
        xpEarned: 1,
        achievementsWon: 1,
        awardsEarned: 1,
        awardsByType: 1,
      },
    },

    /* 7️⃣  deterministic order (same as rank) --------------------------- */
    { $sort: { xpEarned: -1, accountId: 1 } },
  ];

  const leaderboard = await db.db
    .collection("player-achievements")
    .aggregate(pipeline)
    .limit(10)
    .toArray();

  return c.json(leaderboard);
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
        }
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
                  0
                ),
                totalProductXP: achievementsSets.reduce(
                  (acc, curr) =>
                    acc +
                    curr.achievements.reduce((acc, curr) => acc + curr.xp, 0),
                  0
                ),
              },
            },
          });
        })
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

      await client.set(cacheKey, JSON.stringify(result), "EX", 60);

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

    await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

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
    p.achievementSets.map((a) => a.achievementSetId)
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
  if (!id) return c.json({ message: "Missing id parameter" }, 400);

  const cacheKey = `epic-profile:${id}:rare-achievements:v2`;
  const hit = await client.get(cacheKey);
  if (hit) {
    return c.json(JSON.parse(hit), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const pipeline = [
    /* 0️⃣  one index–friendly filter ---------------------------------- */
    {
      $match: {
        epicAccountId: id,
        playerAchievements: {
          $elemMatch: { "playerAchievement.unlocked": true },
        },
      },
    },

    /* 1️⃣  flatten only the unlocked rows ----------------------------- */
    { $unwind: "$playerAchievements" },
    { $match: { "playerAchievements.playerAchievement.unlocked": true } },

    /* 2️⃣  join the achievement meta to get completedPercent ---------- */
    {
      $lookup: {
        from: "achievementsets",
        let: {
          setId: "$playerAchievements.playerAchievement.achievementSetId",
          name: "$playerAchievements.playerAchievement.achievementName",
        },
        pipeline: [
          { $match: { $expr: { $eq: ["$achievementSetId", "$$setId"] } } },
          { $unwind: "$achievements" },
          { $match: { $expr: { $eq: ["$achievements.name", "$$name"] } } },
          {
            $project: {
              _id: 0,
              sandboxId: 1,
              achievementSetId: 1,
              achievement: "$achievements",
            },
          },
        ],
        as: "achDoc",
      },
    },
    { $unwind: "$achDoc" },

    /* 3️⃣  glue player-data + meta, keep only fields we need ---------- */
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            "$achDoc.achievement",
            {
              sandboxId: "$achDoc.sandboxId",
              achievementSetId: "$achDoc.achievementSetId",
              unlocked: true,
              unlockDate: "$playerAchievements.playerAchievement.unlockDate",
            },
          ],
        },
      },
    },

    /* 4️⃣  ✨ TOP 25 rarest, heap-based — NO big sort ------------------ */
    {
      $group: {
        _id: null,
        rare25: {
          $topN: {
            n: 25,
            sortBy: { completedPercent: 1 },
            output: "$$ROOT",
          },
        },
      },
    },
    { $unwind: "$rare25" },
    { $replaceRoot: { newRoot: "$rare25" } },

    /* 5️⃣  only now fetch the BASE_GAME offer (<= 25 lookups) ---------- */
    {
      $lookup: {
        from: "offers",
        let: { sbx: "$sandboxId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$namespace", "$$sbx"] },
                  { $eq: ["$offerType", "BASE_GAME"] },
                  { $eq: ["$isCodeRedemptionOnly", false] },
                ],
              },
            },
          },
          { $sort: { isDisplayable: -1, title: 1, lastModifiedDate: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 0,
              id: 1,
              namespace: 1,
              keyImages: 1,
              title: 1,
              productSlug: 1,
            },
          },
        ],
        as: "offer",
      },
    },
    { $unwind: { path: "$offer", preserveNullAndEmptyArrays: true } },
  ];

  const rare = await db.db
    .collection("player-achievements")
    .aggregate(pipeline, { allowDiskUse: true })
    .toArray();

  // Cache for 1 day
  await client.set(cacheKey, JSON.stringify(rare), "EX", 86400);

  return c.json(rare, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
});

app.get("/:id/rare-achievements/:sandboxId", async (c) => {
  const { id, sandboxId } = c.req.param();
  if (!id || !sandboxId) {
    return c.json({ message: "Missing id or sandboxId parameter" }, 400);
  }

  const cacheKey = `epic-profile:${id}:${sandboxId}:rare-achievements:v2`;
  const hit = await client.get(cacheKey);
  if (hit) {
    return c.json(JSON.parse(hit), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const pipeline = [
    /* 1 – player + sandbox */
    { $match: { epicAccountId: id, sandboxId } },
    { $unwind: "$playerAchievements" },
    { $match: { "playerAchievements.playerAchievement.unlocked": true } },

    /* 2 – join the achievement meta */
    {
      $lookup: {
        from: "achievementsets",
        let: {
          setId: "$playerAchievements.playerAchievement.achievementSetId",
          name: "$playerAchievements.playerAchievement.achievementName",
        },
        pipeline: [
          { $match: { $expr: { $eq: ["$achievementSetId", "$$setId"] } } },
          { $unwind: "$achievements" },
          { $match: { $expr: { $eq: ["$achievements.name", "$$name"] } } },
          {
            $project: {
              _id: 0,
              sandboxId: 1,
              achievementSetId: 1,
              achievement: "$achievements",
            },
          },
        ],
        as: "achDoc",
      },
    },
    { $unwind: "$achDoc" },

    /* 3 – merge & shape */
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            "$achDoc.achievement",
            {
              sandboxId: "$achDoc.sandboxId",
              achievementSetId: "$achDoc.achievementSetId",
              unlocked: true,
              unlockDate: "$playerAchievements.playerAchievement.unlockDate",
            },
          ],
        },
      },
    },

    /* 4 – rarest three in this game */
    { $sort: { completedPercent: 1 } },
    { $limit: 3 },
  ];

  const rare = await db.db
    .collection("player-achievements")
    .aggregate(pipeline)
    .toArray();

  await client.set(cacheKey, JSON.stringify(rare), "EX", 3600);

  return c.json(rare, {
    headers: { "Cache-Control": "public, max-age=60" },
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

  // const cached = await client.get(cacheKey);

  // if (cached) {
  //   return c.json(JSON.parse(cached), {
  //     headers: {
  //       "Cache-Control": "public, max-age=60",
  //     },
  //   });
  // }

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

  await client.set(cacheKey, JSON.stringify(result), "EX", 3600);

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

  const epicProfileCacheKey = `epic-profile:${id}:epic-data`;
  const statsCacheKey = `epic-profile:${id}:stats`;

  try {
    // Fetch user profile from Epic Store client (with caching)
    let profile;
    const cachedEpicProfile = await client.get(epicProfileCacheKey);
    if (cachedEpicProfile) {
      profile = JSON.parse(cachedEpicProfile);
    } else {
      profile = await epicStoreClient.getUser(id);
      if (profile) {
        await client.set(
          epicProfileCacheKey,
          JSON.stringify(profile),
          "EX",
          3600
        ); // Cache Epic profile for 1 hour
      }
    }

    if (!profile) {
      c.status(404);
      return c.json({
        message: "Profile not found",
      });
    }

    // Fetch user profile from the database (no caching)
    const [dbProfile, donations] = await Promise.all([
      db.db.collection("epic").findOne({
        accountId: id,
      }),
      db.db
        .collection("key-codes")
        .find({
          accountId: id,
        })
        .toArray(),
    ]);

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
        }
      );
    }

    // Calculate stats (with caching)
    let stats;
    const cachedStats = await client.get(statsCacheKey);
    if (cachedStats) {
      stats = JSON.parse(cachedStats);
    } else {
      const [statsResult, reviewsCount] = await Promise.all([
        db.db
          .collection("player-achievements")
          .aggregate([
            { $match: { epicAccountId: id } },
            {
              $group: {
                _id: "$sandboxId",
                playerAwards: { $first: "$playerAwards" },
                totalUnlocked: { $first: "$totalUnlocked" },
                totalXP: { $first: "$totalXP" },
              },
            },
            {
              $group: {
                _id: null,
                totalGames: { $sum: 1 },
                totalPlayerAwards: {
                  $sum: {
                    $size: { $ifNull: ["$playerAwards", []] },
                  },
                },
                totalAchievements: { $sum: { $ifNull: ["$totalUnlocked", 0] } },
                totalXP: { $sum: { $ifNull: ["$totalXP", 0] } },
              },
            },
          ])
          .toArray(),
        db.db.collection("reviews").countDocuments({ userId: id }),
      ]);

      const calculatedXP =
        (statsResult[0]?.totalXP || 0) +
        (statsResult[0]?.totalPlayerAwards || 0) * 250;

      stats = {
        totalGames: statsResult[0]?.totalGames || 0,
        totalAchievements: statsResult[0]?.totalAchievements || 0,
        totalPlayerAwards: statsResult[0]?.totalPlayerAwards || 0,
        totalXP: calculatedXP,
        reviewsCount,
      };

      await client.set(statsCacheKey, JSON.stringify(stats), "EX", 300); // Cache stats for 5 minutes
    }

    // Construct the result object with fresh DB data
    const result = {
      ...profile,
      stats,
      avatar: {
        small: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.small,
        medium: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.medium,
        large: dbProfile?.avatarUrl?.variants[0] ?? profile?.avatar?.large,
      },
      linkedAccounts: dbProfile?.linkedAccounts,
      creationDate: dbProfile?.creationDate,
      donations: donations.flatMap((d) => d.details),
      discord: dbProfile?.discordId ? true : false,
    };

    return c.json(result, {
      headers: {
        "Cache-Control": "no-cache",
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
    return c.json({ message: "Missing id parameter" });
  }

  const cacheKey = `epic-profile:${id}:games:page:${pageNum}:limit:${limitNum}`;

  const cached = await client.get(cacheKey);
  if (cached)
    return c.json(JSON.parse(cached), {
      headers: { "Cache-Control": "public, max-age=60" },
    });

  try {
    /** ─────────── ensure the user exists ─────────── */
    const profile = await epicStoreClient.getUser(id);
    if (!profile) {
      c.status(404);
      return c.json({ message: "Profile not found" });
    }

    /** ─────────── aggregation pipeline ───────────── */
    const pipeline = [
      /* 1️⃣  keep rows for this account only -------------------------------- */
      { $match: { epicAccountId: id } },

      /* 2️⃣  collapse possible duplicates per sandbox ---------------------- */
      {
        $group: {
          _id: "$sandboxId",
          totalUnlocked: { $max: "$totalUnlocked" },
          totalXP: { $max: "$totalXP" },
          playerAwards_arr: { $push: "$playerAwards" }, // later flattened
        },
      },

      /* 3️⃣  flatten & dedupe the player-awards array ---------------------- */
      {
        $addFields: {
          playerAwards: {
            $reduce: {
              input: "$playerAwards_arr",
              initialValue: [],
              in: { $setUnion: ["$$value", "$$this"] },
            },
          },
        },
      },
      { $project: { playerAwards_arr: 0 } },

      /* 4️⃣  join ONE BASE_GAME offer per sandbox -------------------------- */
      {
        $lookup: {
          from: "offers",
          let: { sbx: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$namespace", "$$sbx"] },
                    { $eq: ["$offerType", "BASE_GAME"] },
                    { $eq: ["$isCodeRedemptionOnly", false] },
                  ],
                },
              },
            },
            { $sort: { isDisplayable: -1, title: 1, lastModifiedDate: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                id: 1,
                namespace: 1,
                keyImages: 1,
                title: 1,
                productSlug: 1,
              },
            },
          ],
          as: "offer",
        },
      },
      { $unwind: { path: "$offer", preserveNullAndEmptyArrays: true } },

      /* 5️⃣  pull every achievement-set living in that sandbox ------------- */
      {
        $lookup: {
          from: "achievementsets",
          localField: "_id",
          foreignField: "sandboxId",
          as: "achievementSets",
        },
      },

      /* 6-A  compute grand totals across all sets ------------------------- */
      {
        $addFields: {
          totalAchievements: {
            $sum: {
              $map: {
                input: "$achievementSets",
                as: "s",
                in: { $size: "$$s.achievements" },
              },
            },
          },
          totalProductXP: {
            $sum: {
              $map: {
                input: "$achievementSets",
                as: "s",
                in: {
                  $reduce: {
                    input: "$$s.achievements",
                    initialValue: 0,
                    in: { $add: ["$$value", "$$this.xp"] },
                  },
                },
              },
            },
          },
        },
      },

      /* 6-B  assemble final shape & completion % -------------------------- */
      {
        $addFields: {
          productAchievements: {
            totalAchievements: "$totalAchievements",
            totalProductXP: "$totalProductXP",
          },
          completionPercentage: {
            $cond: [
              { $eq: ["$totalAchievements", 0] },
              0,
              { $divide: ["$totalUnlocked", "$totalAchievements"] },
            ],
          },
          baseOfferForSandbox: {
            id: "$offer.id",
            namespace: "$offer.namespace",
            keyImages: "$offer.keyImages",
          },
          product: {
            name: "$offer.title",
            slug: "$offer.productSlug",
          },
          sandboxId: "$_id",
        },
      },

      /* 6-C  remove helper fields we no longer need ----------------------- */
      {
        $project: {
          _id: 0,
          offer: 0,
          achievementSets: 0,
          totalAchievements: 0,
          totalProductXP: 0,
        },
      },

      /* 7️⃣  sort: % complete ↓ ,   name ↑ ,   sandboxId ↑ ---------------- */
      {
        $sort: {
          completionPercentage: -1,
          "product.name": 1,
          sandboxId: 1,
        },
      },

      {
        $sort: {
          isComplete: -1,
          totalXP: -1,
          totalUnlocked: -1,
          completionPercentage: -1,
          "product.name": 1,
          sandboxId: 1,
        },
      },

      /* 8️⃣  facet for pagination + total count in one pass ---------------- */
      {
        $facet: {
          paginated: [
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
          ],
          total: [{ $count: "value" }],
        },
      },
      {
        $addFields: {
          total: { $ifNull: [{ $arrayElemAt: ["$total.value", 0] }, 0] },
        },
      },
    ];

    const [{ paginated, total = 0 }] = await db.db
      .collection("player-achievements")
      .aggregate(pipeline)
      .toArray();

    /** ─────────── build & cache response ─────────── */
    const result = {
      achievements: paginated,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    };

    await client.set(cacheKey, JSON.stringify(result), "EX", 60);

    return c.json(result, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    console.error("aggregation error", err);
    c.status(400);
    return c.json({ message: "Failed to fetch achievements" });
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

    await client.set(cacheKey, JSON.stringify(result), "EX", 360);

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

app.put("/:id/refresh", async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: "Missing id parameter",
    });
  }

  const isDonor = await db.db.collection("key-codes").findOne({
    accountId: id,
  });

  const ttl = !isDonor ? 15 * 60 * 1000 : 2 * 60 * 1000;

  const job = await refreshAchievementsQueue.add(
    `refresh-achievements:${id}`,
    {
      accountId: id,
    },
    {
      deduplication: {
        id: `refresh-achievements:${id}`,
        ttl,
      },
    }
  );

  consola.info("Job added", job.asJSON());

  await client.set(
    `refresh-achievements:${id}`,
    JSON.stringify(job.asJSON()),
    "EX",
    ttl
  );

  return c.json({
    message: "Refresh achievements job added",
  });
});

app.get("/:id/refresh-status", async (c) => {
  const { id } = c.req.param();

  const isDonor = await db.db.collection("key-codes").findOne({
    accountId: id,
  });

  const ttl = !isDonor ? 15 * 60 * 1000 : 2 * 60 * 1000;

  const exists = await client.get(`refresh-achievements:${id}`);

  if (!exists) {
    return c.json({
      canRefresh: true,
      remainingTime: 0,
    });
  }

  const job = JSON.parse(exists);

  const remainingTime = Math.max(
    0,
    Math.ceil((ttl - (Date.now() - job.timestamp)) / 1000)
  );

  if (remainingTime > 0) {
    return c.json({
      canRefresh: false,
      remainingTime,
    });
  }

  return c.json({
    canRefresh: true,
    remainingTime: 0,
  });
});

export default app;
