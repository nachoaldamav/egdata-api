import { Hono } from "hono";
import mongoose from "mongoose";
import client from "../clients/redis";
import { AchievementSet } from "../db/schemas/achievements";
import { Namespace } from "../db/schemas/namespace";
import { Item } from "../db/schemas/item";
import { Offer } from "../db/schemas/offer";
import { Asset } from "../db/schemas/assets";
import { db } from "../db";

const app = new Hono();

app.get("/", async (ctx) => {
	const start = Date.now();
	const page = Number.parseInt(ctx.req.query("page") || "1", 10);
	const limit = Math.min(
		Number.parseInt(ctx.req.query("limit") || "10", 10),
		100,
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
		},
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
		},
	);
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

app.get("/:sandboxId/achievements", async (ctx) => {
	const start = Date.now();
	const { sandboxId } = ctx.req.param();

	const cacheKey = `sandbox:${sandboxId}:achivement-sets`;
	const cached = await client.get(cacheKey);

	let achievementSets: mongoose.InferRawDocType<typeof AchievementSet>[] = [];

	if (cached) {
		achievementSets = JSON.parse(cached);
	} else {
		const sandbox = await Namespace.findOne({
			namespace: sandboxId,
		});

		if (!sandbox) {
			ctx.status(404);

			return ctx.json({
				message: "Sandbox not found",
			});
		}

		achievementSets = await AchievementSet.find(
			{
				sandboxId,
			},
			{
				_id: false,
				__v: false,
			},
		);

		await client.set(cacheKey, JSON.stringify(achievementSets), {
			EX: 1800, // 30min
		});
	}

	return ctx.json(
		{
			sandboxId,
			achievementSets,
		},
		200,
		{
			"Server-Timing": `db;dur=${Date.now() - start}`,
		},
	);
});

app.get("/:sandboxId/items", async (ctx) => {
	const { sandboxId } = ctx.req.param();

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

	const items = await Item.find(
		{
			namespace: sandboxId,
		},
		undefined,
		{
			sort: {
				lastModified: -1,
			},
		},
	);

	return ctx.json(items, 200, {
		"Cache-Control": "public, max-age=60",
	});
});

app.get("/:sandboxId/offers", async (ctx) => {
	const { sandboxId } = ctx.req.param();

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

	const offers = await Offer.find(
		{
			namespace: sandboxId,
		},
		{
			_id: 0,
			id: 1,
			title: 1,
			description: 1,
			namespace: 1,
			offerType: 1,
			effectiveDate: 1,
			creationDate: 1,
			lastModifiedDate: 1,
			keyImages: 1,
			productSlug: 1,
			releaseDate: 1,
		},
		{
			sort: {
				lastModified: -1,
			},
		},
	);

	return ctx.json(offers);
});

app.get("/:sandboxId/assets", async (ctx) => {
	const { sandboxId } = ctx.req.param();

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

	const assets = await Asset.find(
		{
			namespace: sandboxId,
		},
		undefined,
		{
			sort: {
				lastModified: -1,
			},
		},
	);

	return ctx.json(assets);
});

export default app;
