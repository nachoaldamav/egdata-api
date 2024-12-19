import { Hono } from "hono";
import { Offer } from "@egdata/core.schemas.offers";
import { PriceEngine } from "@egdata/core.schemas.price";
import { Collection, GamePosition } from "@egdata/core.schemas.collections";
import { getCookie } from "hono/cookie";
import { regions } from "../utils/countries.js";
import client from "../clients/redis.js";

const app = new Hono();

app.get("/:slug", async (c) => {
  const { slug } = c.req.param();

  const country = c.req.query("country");
  const cookieCountry = getCookie(c, "EGDATA_COUNTRY");

  const selectedCountry = country ?? cookieCountry ?? "US";

  const region = Object.keys(regions).find((r) =>
    regions[r].countries.includes(selectedCountry),
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

  const cacheKey = `collections:${slug}:${region}:${page}:${limit}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      'Cache-Control': 'public, max-age=60',
    });
  }

  const collection = await Collection.findOne({
    _id: slug,
  });

  if (!collection) {
    c.status(404);
    return c.json({
      message: "Collection not found",
    });
  }

  const totalOffersCount = await GamePosition.countDocuments({
    collectionId: collection._id,
    position: { $gt: 0 },
  });

  const offersList = await GamePosition.find({
    collectionId: collection._id,
    position: { $gt: 0 },
  })
    .sort({ position: 1 })
    .limit(limit)
    .skip(skip)

  const offersIds = offersList.map((o) => o.offerId);

  const [offersData, pricesData] = await Promise.allSettled([
    Offer.find({
      id: { $in: offersIds },
    }),
    PriceEngine.find({
      offerId: { $in: offersIds },
      region,
    }),
  ]);

  const offers = offersData.status === "fulfilled" ? offersData.value : [];
  const prices = pricesData.status === "fulfilled" ? pricesData.value : [];

  const result = {
    elements: offers
      .map((o) => {
        const price = prices.find((p) => p.offerId === o.id);
        const collectionOffer = offersList.find((i) => i.toJSON().offerId === o.id);

        console.log(`Offer ${o.title} has position ${collectionOffer?.position}`);

        return {
          ...o.toObject(),
          price: price ?? null,
          position: collectionOffer?.position ?? totalOffersCount,
          previousPosition: collectionOffer?.previous,
          metadata: collectionOffer,
        };
      })
      .sort(
        (a, b) =>
          (a.position ?? totalOffersCount) - (b.position ?? totalOffersCount),
      ),
    page,
    limit,
    title: collection.name,
    total: totalOffersCount,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

export default app;
