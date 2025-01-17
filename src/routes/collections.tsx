import React from "react";
import { Hono } from "hono";
import { Offer } from "@egdata/core.schemas.offers";
import { PriceEngine } from "@egdata/core.schemas.price";
import { Collection, GamePosition } from "@egdata/core.schemas.collections";
import { getCookie } from "hono/cookie";
import { regions } from "../utils/countries.js";
import client from "../clients/redis.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getImage } from "../utils/get-image.js";
import satori from "satori";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { db } from "../db/index.js";

/**
 * This function converts a week string (e.g. 2022W01) to a start and end date.
 * @param week A string in the format YYYYWNN (e.g., "2022W01").
 * @returns An object with the start and end dates of the given week.
 */
function getWeek(week: `${number}W${number}`): { start: Date; end: Date } {
  const [year, weekNumber] = week.split("W").map(Number);

  // Jan 4th of the given year is always in week 1 according to ISO-8601
  const jan4 = new Date(Date.UTC(year, 0, 4));

  // Find the first Monday of the ISO week year
  const dayOfWeek = jan4.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((dayOfWeek + 6) % 7)); // Adjust to the previous Monday if necessary

  // Calculate the start date of the given week
  const start = new Date(firstMonday);
  start.setUTCDate(firstMonday.getUTCDate() + (weekNumber - 1) * 7);

  // Calculate the end date of the given week
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return { start, end };
}

const app = new Hono();

app.get("/:slug", async (c) => {
  const { slug } = c.req.param();

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

  const cacheKey = `collections:${slug}:${region}:${page}:${limit}:v0.1`;

  const cached = await client.get(cacheKey);

  if (cached) {
    return c.json(JSON.parse(cached), 200, {
      "Cache-Control": "public, max-age=60",
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
    .skip(skip);

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
        const collectionOffer = offersList.find(
          (i) => i.toJSON().offerId === o.id
        );

        console.log(
          `Offer ${o.title} has position ${collectionOffer?.position}`
        );

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
          (a.position ?? totalOffersCount) - (b.position ?? totalOffersCount)
      ),
    page,
    limit,
    title: collection.name,
    total: totalOffersCount,
    updatedAt: collection.updatedAt.toISOString(),
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

/**
 * Gets the collection's offers for a specific week
 * The week is formatted as YYYYWNN (2023W01)
 */
app.get("/:slug/:week", async (c) => {
  const { slug, week } = c.req.param();
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

  const cacheKey = `collections:${week}:${slug}:${region}:${page}:${limit}`;

  // const cached = await client.get(cacheKey);

  // if (cached) {
  //   return c.json(JSON.parse(cached), 200, {
  //     "Cache-Control": "public, max-age=60",
  //   });
  // }

  const { start, end } = getWeek(week as `${number}W${number}`);

  const collection = await Collection.findOne({ _id: slug });

  if (!collection) {
    return c.json({ error: "Collection not found" }, 404);
  }

  const offers = await GamePosition.find({
    collectionId: collection._id,
  });

  console.log(`Found ${offers.length} offers`);

  // Get the positions for each offer in the given week
  const offersInsideWeek = offers.filter((offer) =>
    offer.positions.some(
      (position) =>
        new Date(position.date).getTime() >= start.getTime() &&
        new Date(position.date).getTime() <= end.getTime()
    )
  );

  console.log(`Found ${offersInsideWeek.length} offers inside the week`);

  const offersWithPositions = offersInsideWeek.map((offer) => {
    // Find the position closest to the end of the week, but still within the week
    const closestPosition = offer.positions
      .filter((position) => new Date(position.date).getTime() <= end.getTime())
      .sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() // Sort descending by date
      )[0]; // Pick the most recent position within the week

    return {
      ...offer.toJSON(),
      position: closestPosition?.position,
      // Keep only the positions that occur within the week
      positions: offer.positions.filter(
        (position) => new Date(position.date).getTime() <= end.getTime()
      ),
    };
  });

  const positions = offersWithPositions
    .filter((offer) => offer.position)
    .sort((a, b) => a.position - b.position)
    .slice(skip, skip + limit);

  console.log(`Found ${positions.length} after filtering "0" positions`);

  const offerIds = offersWithPositions.map((offer) => offer.offerId);

  const [offersData, pricesData] = await Promise.all([
    Offer.find({
      id: { $in: offerIds },
    }),
    PriceEngine.find({
      offerId: { $in: offerIds },
      region
    }),
  ]);

  const offersWithMetadata = positions.map((offer) => {
    const offerData = offersData.find((o) => o.id === offer.offerId);
    const priceData = pricesData.find((p) => p.offerId === offer.offerId);

    if (!offerData || !priceData) {
      console.error(`Offer or price not found for ${offer.offerId}`);
      return null;
    }

    return {
      ...offerData?.toJSON(),
      metadata: offer,
      price: priceData?.toJSON(),
    };
  });

  const result = {
    elements: offersWithMetadata,
    page,
    limit,
    title: collection.name,
    total: offersInsideWeek.length,
    updatedAt: collection.updatedAt.toISOString(),
    start,
    end,
  };

  await client.set(cacheKey, JSON.stringify(result), {
    EX: 3600,
  });

  return c.json(result, 200, {
    "Cache-Control": "public, max-age=60",
  });
});

app.get("/:slug/:week/og", async (c) => {
  const { slug, week } = c.req.param();
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

  const limit = 4;
  const page = 1;
  const skip = (page - 1) * limit;

  const cacheKey = `collections:${week}:${slug}:${region}:${page}:${limit}:og`;

  // const cached = await client.get(cacheKey);

  // if (cached) {
  //   return c.json(JSON.parse(cached), 200, {
  //     "Cache-Control": "public, max-age=60",
  //   });
  // }

  const { start, end } = getWeek(week as `${number}W${number}`);

  const collection = await Collection.findOne({ _id: slug });

  if (!collection) {
    return c.json({ error: "Collection not found" }, 404);
  }

  const offers = await GamePosition.find({
    collectionId: collection._id,
  });

  console.log(`Found ${offers.length} offers`);

  // Get the positions for each offer in the given week
  const offersInsideWeek = offers.filter((offer) =>
    offer.positions.some(
      (position) =>
        new Date(position.date).getTime() >= start.getTime() &&
        new Date(position.date).getTime() <= end.getTime()
    )
  );

  console.log(`Found ${offersInsideWeek.length} offers inside the week`);

  const offersWithPositions = offersInsideWeek.map((offer) => {
    // Find the position closest to the end of the week, but still within the week
    const closestPosition = offer.positions
      .filter((position) => new Date(position.date).getTime() <= end.getTime())
      .sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() // Sort descending by date
      )[0]; // Pick the most recent position within the week

    return {
      ...offer.toJSON(),
      position: closestPosition?.position,
      // Keep only the positions that occur within the week
      positions: offer.positions.filter(
        (position) => new Date(position.date).getTime() <= end.getTime()
      ),
    };
  });

  const positions = offersWithPositions
    .filter((offer) => offer.position)
    .sort((a, b) => a.position - b.position)
    .slice(skip, skip + limit);

  console.log(`Found ${positions.length} after filtering "0" positions`);

  const hash = createHash("sha256");

  hash.update(JSON.stringify(positions));

  const hex = hash.digest("hex");

  // Check if the image already exists in the database
  const existingImage = await db.db
    .collection("tops-og")
    .findOne({ hash: hex });

  if (existingImage) {
    return c.json({ id: existingImage.imageId, url: `https://cdn.egdata.app/cdn-cgi/imagedelivery/RlN2EBAhhGSZh5aeUaPz3Q/${existingImage.imageId}/og` }, 200);
  }

  const offerIds = offersWithPositions.map((offer) => offer.offerId);

  const [offersData] = await Promise.all([
    Offer.find({
      id: { $in: offerIds },
    }),
  ]);

  const offersWithMetadata = positions.map((offer) => {
    const offerData = offersData.find((o) => o.id === offer.offerId);

    if (!offerData) {
      console.error(`Offer or price not found for ${offer.offerId}`);
      return null;
    }

    return {
      ...offerData?.toJSON(),
      metadata: offer,
    };
  });

  const svg = await satori(
    // @ts-expect-error
    <div
      style={{
        width: "1300px",
        height: "630px",
        display: "flex",
        flexDirection: "column",
        background: "#001B3D",
        fontFamily: "Inter, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Gradient Background */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "linear-gradient(135deg, rgba(0, 27, 61, 1) 0%, rgba(0, 9, 19, 1) 100%)",
        }}
      />
      {/* Background Pattern */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            "linear-gradient(to bottom, rgba(0, 120, 242, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 120, 242, 0.05) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
          opacity: 0.3,
        }}
      />
      {/* Content Container */}
      <div
        style={{
          padding: "40px",
          flex: 1,
          display: "flex",
          flexDirection: "row",
          position: "relative",
          zIndex: 1,
          gap: "30px",
        }}
      >
        {/* Header */}
        <div
          style={{
            marginBottom: "40px",
            display: "flex",
            flexDirection: "column",
            width: "375px",
          }}
        >
          <div
            style={{
              fontSize: "32px",
              color: "rgba(255, 255, 255, 0.9)",
              marginBottom: "16px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              display: "flex",
            }}
          >
            {start.toLocaleString("en-UK", {
              day: "numeric",
              month: "short",
            })}{" "}
            -{" "}
            {end.toLocaleString("en-UK", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <div
            style={{
              fontSize: "72px",
              fontWeight: 800,
              color: "#FFFFFF",
              textShadow: "0 0 30px rgba(0, 120, 242, 0.3)",
            }}
          >
            {collection.name}
          </div>
        </div>
        {/* Games Grid */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            gap: "20px",
            width: "800px",
          }}
        >
          {offersWithMetadata
            .filter((o) => o !== null)
            .slice(0, 4) // Limit to top 4 games
            .map((game) => (
              <div
                key={game.id}
                style={{
                  width: "48%", // Two items per row
                  background: "rgba(255, 255, 255, 0.05)",
                  borderRadius: "12px",
                  padding: "16px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  boxShadow: "0 20px 40px rgba(0, 0, 0, 0.3)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "160px",
                    background: "rgba(0, 120, 242, 0.1)",
                    borderRadius: "8px",
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  <img
                    src={
                      getImage(game?.keyImages || [], [
                        "DieselGameBoxWide",
                        "OfferImageWide",
                        "Featured",
                        "DieselStoreFrontWide",
                        "VaultClosed",
                      ])?.url
                    }
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "8px",
                    }}
                    alt={game.title}
                  />
                  <span
                    style={{
                      position: "absolute",
                      top: "0px",
                      right: "0px",
                      fontSize: "32px",
                      fontWeight: 900,
                      color: "#FFFFFF",
                      textShadow: "0 0 30px rgba(0, 120, 242, 0.3)",
                      background: "rgba(0, 0, 0, 0.7)",
                      backdropFilter: "blur(10px)",
                      padding: "4px 8px",
                      borderRadius: "0 8px 0 0",
                    }}
                  >
                    {game.metadata.position}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: "white",
                    marginBottom: "8px",
                    display: "flex",
                  }}
                >
                  {game.title}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>,
    {
      width: 1300,
      height: 630,
      fonts: [
        {
          name: "Roboto",
          data: readFileSync(resolve("./src/static/Roboto-Light.ttf")),
          weight: 400,
          style: "normal",
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [resolve("./src/static/Roboto-Light.ttf")],
      loadSystemFonts: false,
    },
    fitTo: {
      mode: "width",
      value: 2800,
    },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const cfImagesUrl =
    "https://api.cloudflare.com/client/v4/accounts/7da0b3179a5b5ef4f1a2d1189f072d0b/images/v1";
  const accessToken = process.env.CF_IMAGES_KEY;

  const formData = new FormData();
  formData.set(
    "file",
    new Blob([pngBuffer], { type: "image/png" }),
    // Generate a hash from the free games data
    `tops-og/${hex}.png`
  );

  const response = await fetch(cfImagesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    console.error("Failed to upload image", await response.json());
    return c.json({ error: "Failed to upload image" }, 400);
  }

  const responseData = (await response.json()) as { result: { id: string } };

  // Save the image ID in the database
  await db.db.collection("tops-og").updateOne(
    {
      id: responseData.result.id,
    },
    {
      $set: {
        imageId: responseData.result.id,
        hash: hex,
      },
    },
    {
      upsert: true,
    }
  );

  return c.json(
    {
      id: responseData.result.id,
      url: `https://cdn.egdata.app/cdn-cgi/imagedelivery/RlN2EBAhhGSZh5aeUaPz3Q/${responseData.result.id}/og`,
    },
    200
  );
});

export default app;
