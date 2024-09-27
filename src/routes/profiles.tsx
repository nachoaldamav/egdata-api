import { Hono } from 'hono';
import { epicStoreClient } from '../clients/epic.js';
import client from '../clients/redis.js';
import type { AchievementsSummary } from '../types/get-user-achievements.js';
import { db } from '../db/index.js';
import { Sandbox } from '../db/schemas/sandboxes.js';
import { Offer } from '../db/schemas/offer.js';
import {
  AchievementSet,
  type AchievementType,
} from '../db/schemas/achievements.js';

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

const app = new Hono();

app.get('/:id', async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:v0.3`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  try {
    const profile = await epicStoreClient.getUser(id);
    const dbProfile = await db.db.collection('epic').findOne({
      accountId: id,
    });

    if (dbProfile && !dbProfile.creationDate) {
      dbProfile.creationDate = new Date();
      await db.db.collection('epic').updateOne(
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
      .collection('reviews')
      .countDocuments({ userId: id });

    if (!profile) {
      c.status(404);
      return c.json({
        message: 'Profile not found',
      });
    }

    const savedPlayerAchievements = await db.db
      .collection('player-achievements')
      .find<PlayerProductAchievements>({ epicAccountId: id })
      .toArray();

    if (savedPlayerAchievements) {
      const achievements: AchievementsSummary[] = [];

      await Promise.all(
        savedPlayerAchievements.map(async (entry) => {
          const sandbox = await Sandbox.findOne({ _id: entry.sandboxId });

          if (!sandbox) {
            console.error('Sandbox not found', entry.sandboxId);
            return;
          }

          const [product, offer, achievementsSets] = await Promise.all([
            db.db
              .collection('products')
              .findOne({ _id: sandbox?.parent as unknown as Id }),
            Offer.findOne({
              namespace: entry.sandboxId,
              offerType: 'BASE_GAME',
            }),
            AchievementSet.find({
              sandboxId: entry.sandboxId,
            }),
          ]);

          if (!product || !offer) {
            return;
          }

          achievements.push({
            __typename: 'AchievementsSummaryResponseSuccess',
            status: '200',
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
          __typename: 'AchievementsSummaryResponse',
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
          'Cache-Control': 'public, max-age=60',
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    console.error('Error fetching profile', err);
    c.status(400);
    return c.json({
      message: 'Failed to fetch profile',
    });
  }
});

app.get('/:id/achievements/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  if (!id || !sandboxId) {
    c.status(400);
    return c.json({
      message: 'Missing id or sandboxId parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:${sandboxId}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  const playerAchievements = await db.db
    .collection('player-achievements')
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

app.get('/:id/rare-achievements', async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:rare-achievements`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // Get all the achievements for the player
  const playerAchievements = await db.db
    .collection('player-achievements')
    .find<PlayerProductAchievements>({
      epicAccountId: id,
    })
    .toArray();

  const achievementsSetsIds = playerAchievements.flatMap((p) =>
    p.achievementSets.map((a) => a.achievementSetId)
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
    }))
  );

  // Sort by rarity (completedPercent)
  const sortedAchievements = allAchievements.sort(
    (a, b) => a.completedPercent - b.completedPercent
  );

  const allPlayerAchievements = playerAchievements.flatMap(
    (p) => p.playerAchievements
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
        p.playerAchievement.achievementSetId === achievement.achievementSetId
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
    offerType: ['BASE_GAME', 'DLC'],
    prePurchase: { $ne: true },
  });

  const selectedAchievements = response.map((r) => {
    const offer = offers
      .sort((a, b) => (a.offerType === 'BASE_GAME' ? -1 : 1))
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
      'Cache-Control': 'public, max-age=60',
    },
  });
});

app.get('/:id/rare-achievements/:sandboxId', async (c) => {
  const { id, sandboxId } = c.req.param();

  if (!id || !sandboxId) {
    c.status(400);
    return c.json({
      message: 'Missing id or sandboxId parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:${sandboxId}:rare-achievements:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // Get all the achievements for the player
  const playerAchievements = await db.db
    .collection('player-achievements')
    .find<PlayerProductAchievements>({
      epicAccountId: id,
      sandboxId: sandboxId,
    })
    .toArray();

  const achievementsSetsIds = playerAchievements.flatMap((p) =>
    p.achievementSets.map((a) => a.achievementSetId)
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
            (pa) => pa.playerAchievement.achievementName === achievement.name
          )
        )
        ?.playerAchievements.find(
          (pa) => pa.playerAchievement.achievementName === achievement.name
        )?.playerAchievement.unlocked,
      unlockDate: playerAchievements
        .find((p) =>
          p.playerAchievements.some(
            (pa) => pa.playerAchievement.achievementName === achievement.name
          )
        )
        ?.playerAchievements.find(
          (pa) => pa.playerAchievement.achievementName === achievement.name
        )?.playerAchievement.unlockDate,
    }))
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
      'Cache-Control': 'public, max-age=60',
    },
  });
});

app.get('/:id/achievements', async (c) => {
  const { id } = c.req.param();
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '25'), 100);
  const page = Math.min(Number.parseInt(c.req.query('page') ?? '1'), 100);
  const skip = (page - 1) * limit;

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:achievements:${limit}:${page}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  const [playerUnlockedAchievements, count] = await Promise.all([
    db.db
      .collection('player-achievements')
      .aggregate([
        {
          $match: {
            epicAccountId: id,
          },
        },
        {
          $unwind: '$playerAchievements',
        },
        {
          $match: {
            'playerAchievements.playerAchievement.unlocked': true,
          },
        },
        {
          $sort: {
            'playerAchievements.playerAchievement.unlockDate': -1,
          },
        },
        {
          $skip: skip,
        },
        {
          $limit: limit,
        },
        {
          $lookup: {
            from: 'achievementsets',
            // Replace with the actual name of your achievements definitions collection
            let: {
              achievementName:
                '$playerAchievements.playerAchievement.achievementName',
              sandboxId: '$playerAchievements.playerAchievement.sandboxId',
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$sandboxId', '$$sandboxId'],
                  },
                },
              },
              {
                $unwind: '$achievements',
              },
              {
                $match: {
                  $expr: {
                    $eq: ['$achievements.name', '$$achievementName'],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  achievementDetails: '$achievements',
                },
              },
            ],
            as: 'achievementDetails',
          },
        },
        {
          $unwind: {
            path: '$achievementDetails',
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $project: {
            _id: 0,
            achievementName:
              '$playerAchievements.playerAchievement.achievementName',
            unlockDate: '$playerAchievements.playerAchievement.unlockDate',
            XP: '$playerAchievements.playerAchievement.XP',
            sandboxId: '$playerAchievements.playerAchievement.sandboxId',
            isBase: '$playerAchievements.playerAchievement.isBase',
            achievementDetails: '$achievementDetails.achievementDetails',
          },
        },
      ])
      .toArray(),
    db.db
      .collection('player-achievements')
      .aggregate([
        { $match: { epicAccountId: id } },
        { $unwind: '$playerAchievements' },
        { $match: { 'playerAchievements.playerAchievement.unlocked': true } },
        { $count: 'count' },
      ])
      .toArray(),
  ]);

  const offers = await Offer.find({
    namespace: {
      $in: playerUnlockedAchievements.map((r) => r.sandboxId),
    },
    offerType: ['BASE_GAME', 'DLC'],
    prePurchase: { $ne: true },
  });

  const selectedAchievements = playerUnlockedAchievements.map((r) => {
    const offer = offers
      .sort((a, b) => (a.offerType === 'BASE_GAME' ? -1 : 1))
      .find((o) => o.namespace === r.sandboxId);
    return {
      ...r.achievementDetails,
      unlocked: r.unlocked,
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
      'Cache-Control': 'public, max-age=60',
    },
  });
});

app.get('/:id/information', async (c) => {
  const { id } = c.req.param();

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:v0.3`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  try {
    // Fetch user profile from Epic Store client
    const profile = await epicStoreClient.getUser(id);

    if (!profile) {
      c.status(404);
      return c.json({
        message: 'Profile not found',
      });
    }

    // Fetch user profile from the database
    const dbProfile = await db.db.collection('epic').findOne({
      accountId: id,
    });

    if (dbProfile && !dbProfile.creationDate) {
      dbProfile.creationDate = new Date();
      await db.db.collection('epic').updateOne(
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

    // Fetch total stats
    const statsArray = await db.db
      .collection('player-achievements')
      .aggregate([
        { $match: { epicAccountId: id } },
        {
          $project: {
            totalPlayerAwardsCount: {
              $size: { $ifNull: ['$playerAwards', []] },
            },
            totalUnlocked: 1,
          },
        },
        {
          $group: {
            _id: null,
            totalGames: { $sum: 1 },
            totalPlayerAwards: { $sum: '$totalPlayerAwardsCount' },
            totalAchievements: { $sum: '$totalUnlocked' },
          },
        },
      ])
      .toArray();

    const stats = statsArray[0] || {
      totalGames: 0,
      totalPlayerAwards: 0,
      totalAchievements: 0,
    };

    // Fetch reviews count
    const reviewsCount = await db.db
      .collection('reviews')
      .countDocuments({ userId: id });

    // Construct the result object
    const result = {
      ...profile,
      stats: {
        totalGames: stats.totalGames,
        totalAchievements: stats.totalAchievements,
        totalPlayerAwards: stats.totalPlayerAwards,
        reviewsCount: reviewsCount,
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    console.error('Error fetching profile', err);
    c.status(400);
    return c.json({
      message: 'Failed to fetch profile',
    });
  }
});

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

app.get('/:id/games', async (c) => {
  const { id } = c.req.param();
  const { page = '1', limit = '10' } = c.req.query();

  const pageNum = Number.parseInt(page, 10);
  const limitNum = Number.parseInt(limit, 10);

  if (!id) {
    c.status(400);
    return c.json({
      message: 'Missing id parameter',
    });
  }

  const cacheKey = `epic-profile:${id}:games:page:${pageNum}:limit:${limitNum}`;

  const cached = await client.get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached), {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  try {
    // Check if user exists
    const profile = await epicStoreClient.getUser(id);

    if (!profile) {
      c.status(404);
      return c.json({
        message: 'Profile not found',
      });
    }

    // Fetch paginated achievements
    const savedPlayerAchievementsCursor = db.db
      .collection('player-achievements')
      .find({ epicAccountId: id })
      // Sort by the totalXP field in descending order
      .sort({ totalXP: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    const savedPlayerAchievements =
      await savedPlayerAchievementsCursor.toArray();

    // Fetch total number of games for pagination
    const totalGames = await db.db
      .collection('player-achievements')
      .countDocuments({ epicAccountId: id });

    const achievements: SingleAchievement[] = [];

    if (savedPlayerAchievements && savedPlayerAchievements.length > 0) {
      await Promise.all(
        savedPlayerAchievements.map(async (entry) => {
          const sandbox = await Sandbox.findOne({ _id: entry.sandboxId });

          if (!sandbox) {
            console.error('Sandbox not found', entry.sandboxId);
            return;
          }

          const [product, offer, achievementsSets] = await Promise.all([
            db.db
              .collection('products')
              .findOne({ _id: sandbox?.parent as unknown as Id }),
            Offer.findOne({
              namespace: entry.sandboxId,
              offerType: 'BASE_GAME',
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
                0
              ),
              totalProductXP: achievementsSets.reduce(
                (acc, curr) =>
                  acc +
                  curr.achievements.reduce((acc, curr) => acc + curr.xp, 0),
                0
              ),
            },
          });
        })
      );
    }

    // Construct the result object
    const result = {
      achievements,
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    console.error('Error fetching achievements', err);
    c.status(400);
    return c.json({
      message: 'Failed to fetch achievements',
    });
  }
});

export default app;
