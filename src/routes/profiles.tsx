import React from "react";
import { Hono } from "hono";
import { epicStoreClient } from "../clients/epic.js";
import client from "../clients/redis.js";
import satori from "satori";
import { getImage } from "../utils/get-image.js";
import type { AchievementsSummary } from "../types/get-user-achievements.js";
import { Resvg } from "@resvg/resvg-js";
import { db } from "../db/index.js";
import { Sandbox } from "../db/schemas/sandboxes.js";
import { Offer } from "../db/schemas/offer.js";
import { AchievementSet } from "../db/schemas/achievements.js";

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

app.get("/:id", async (c) => {
	const { id } = c.req.param();

	if (!id) {
		c.status(400);
		return c.json({
			message: "Missing id parameter",
		});
	}

	const cacheKey = `epic-profile:${id}`;

	//   const cached = await client.get(cacheKey);

	//   if (cached) {
	//     return c.json(JSON.parse(cached), {
	//       headers: {
	//         "Cache-Control": "public, max-age=60",
	//       },
	//     });
	//   }

	try {
		const profile = await epicStoreClient.getUser(id);

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
			console.log(`Found ${savedPlayerAchievements.length} saved achievements`);

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
						console.error("Product or offer not found", entry.sandboxId);
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
			};

			await client.set(cacheKey, JSON.stringify(result), {
				EX: 3600,
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

app.get("/:id/og", async (c) => {
	const { id } = c.req.param();

	if (!id) {
		c.status(400);
		return c.json({
			message: "Missing id parameter",
		});
	}

	const cacheKey = `epic-profile:${id}`;

	const cached = await client.get(cacheKey);

	if (cached) {
		return c.json(JSON.parse(cached), {
			headers: {
				"Cache-Control": "public, max-age=60",
			},
		});
	}

	try {
		// Get the result from Redis
		const result = await client.get(cacheKey);

		const svg = await generateImage({ data: JSON.parse(result) });

		const png = new Resvg(svg, {
			fitTo: {
				mode: "width",
				value: 1200,
			},
		})
			.render()
			.asPng();

		return c.body(png, 200, {
			"Cache-Control": "public, max-age=60",
			"Content-Type": "image/png",
		});
	} catch (err) {
		console.error("Error fetching profile", err);
		c.status(400);
		return c.json({
			message: "Failed to fetch profile",
		});
	}
});

async function generateImage({
	data,
}: { data: { displayName: string; achievements: any } }) {
	const svg = await satori(ReactElement({ data }), {
		width: 1200,
		height: 600,
		fonts: [
			{
				name: "Montserrat",
				data: await fetch("https://egdata.app/fonts/Montserrat-Bold.ttf").then(
					(res) => res.arrayBuffer(),
				),
				weight: 400,
				style: "normal",
			},
		],
	});

	return svg;
}

function ReactElement({
	data,
}: {
	data: {
		displayName: string;
		achievements: AchievementsSummary;
		avatar: {
			small: string;
			medium: string;
			large: string;
		};
	};
}) {
	const userTotalXP = data.achievements.data.reduce(
		(acc, curr) => acc + curr.totalXP,
		0,
	);
	const userLevel = Math.floor(userTotalXP / 250);
	const xpToNextLevel = userTotalXP % 250;
	const percentToNextLevel = (xpToNextLevel / 250) * 100;

	const randomOffer =
		data.achievements.data[
			Math.floor(Math.random() * data.achievements.data.length)
		];
	const offerImageUrl = getImage(
		randomOffer?.baseOfferForSandbox.keyImages ?? [],
		["DieselStoreFrontWide", "OfferImageWide"],
	)?.url;

	return (
		<section
			id="profile-header"
			style={{
				display: "flex",
				flexDirection: "row",
				gap: "10px",
				width: "100%",
				height: "100%",
				backgroundColor: "166 57% 2%",
				color: "white",
			}}
		>
			<span
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
				}}
			>
				<img
					src={offerImageUrl}
					alt={data.displayName}
					style={{
						width: "100%",
						height: "100%",
						objectFit: "cover",
					}}
				/>
			</span>
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
					backgroundColor: "rgba(18, 18, 18, 0.9)",
				}}
			/>
			<img
				src={data.avatar.large}
				alt={data.displayName}
				style={{
					borderRadius: "50%",
					height: "140px",
					width: "140px",
					objectFit: "cover",
					padding: "12px",
				}}
			/>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "18px",
					padding: "12px",
				}}
			>
				<h1 style={{ fontSize: "52px", fontWeight: "100" }}>
					{data.displayName}
				</h1>
				<section
					id="profile-header-achievements"
					style={{
						display: "flex",
						flexDirection: "row",
						width: "100%",
						alignItems: "flex-start",
						justifyContent: "flex-start",
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "10px",
							width: "275px",
							marginRight: "45px",
						}}
					>
						<h2 style={{ fontSize: "22px" }}>Level</h2>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								gap: "10px",
								alignItems: "center",
								marginBottom: "14px",
							}}
						>
							<p
								style={{
									fontSize: "36px",
									fontWeight: "300",
									display: "flex",
									alignItems: "center",
									flexDirection: "row",
									gap: "6px",
								}}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 25 25"
									style={{ width: "28px", height: "28px" }}
								>
									<path
										d="M17.0208 2.24212C16.929 1.91929 16.3877 1.91929 16.2959 2.24212C16.0402 3.14058 15.6679 4.21937 15.2399 4.748C14.7655 5.33397 13.582 5.83545 12.6847 6.14986C12.385 6.25489 12.385 6.74511 12.6847 6.85014C13.582 7.16456 14.7655 7.66603 15.2399 8.252C15.6679 8.78063 16.0402 9.85942 16.2959 10.7579C16.3877 11.0807 16.929 11.0807 17.0208 10.7579C17.2765 9.85942 17.6488 8.78063 18.0768 8.252C18.5512 7.66603 19.7347 7.16456 20.632 6.85014C20.9317 6.74511 20.9317 6.25489 20.632 6.14986C19.7347 5.83544 18.5512 5.33397 18.0768 4.748C17.6488 4.21937 17.2765 3.14058 17.0208 2.24212ZM8.15377 7.54551C8.03104 7.09068 7.28574 7.09068 7.163 7.54551C6.71751 9.19641 6.00657 11.4072 5.17574 12.4335C4.27523 13.5458 1.91486 14.4841 0.317012 15.0195C-0.105671 15.1612 -0.105671 15.8388 0.317012 15.9805C1.91486 16.5159 4.27523 17.4542 5.17574 18.5665C6.00657 19.5928 6.71751 21.8036 7.163 23.4545C7.28574 23.9093 8.03104 23.9093 8.15377 23.4545C8.59926 21.8036 9.31021 19.5928 10.141 18.5665C11.0415 17.4542 13.4019 16.5159 14.9998 15.9805C15.4224 15.8388 15.4224 15.1612 14.9998 15.0195C13.4019 14.4841 11.0415 13.5458 10.141 12.4335C9.31021 11.4072 8.59926 9.19641 8.15377 7.54551Z"
										fill="currentColor"
										fill-rule="evenodd"
										clip-rule="evenodd"
									/>
								</svg>
								{userLevel}
							</p>
							<p style={{ fontSize: "36px", fontWeight: "100" }}>|</p>
							<p style={{ fontSize: "36px", fontWeight: "300" }}>
								{userTotalXP} XP
							</p>
						</div>
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "10px",
								alignItems: "flex-start",
							}}
						>
							<div
								style={{
									width: "100%",
									height: "8px",
									backgroundColor: "rgba(0, 0, 0, 0.5)",
									borderRadius: "100px",
									display: "flex",
									flexDirection: "row",
								}}
							>
								<div
									style={{
										height: "8px",
										backgroundColor: "#fff",
										borderRadius: "100px",
										width: `${percentToNextLevel}%`,
									}}
								/>
							</div>
							<p style={{ fontSize: "14px", fontWeight: "300", opacity: 0.5 }}>
								{xpToNextLevel} XP to next level
							</p>
						</div>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "10px",
							width: "200px",
						}}
					>
						<h2 style={{ fontSize: "22px" }}>Achievements</h2>
						<p
							style={{
								fontSize: "28px",
								fontWeight: "300",
								display: "flex",
								alignItems: "center",
								flexDirection: "row",
								gap: "10px",
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 15 14"
								style={{
									width: "28px",
									height: "28px",
								}}
							>
								<path
									d="M1.78952 1.03177H3.21722C3.21547 1.05694 3.21455 1.08267 3.21455 1.10896L3.21455 2.21484H1.92245V3.65386C1.92245 4.29719 2.17572 4.91418 2.62655 5.36908C2.8022 5.54633 3.00223 5.69331 3.21869 5.8067C3.23933 6.28339 3.33644 6.74005 3.49797 7.16449C2.85933 7.01104 2.26929 6.68172 1.7975 6.20565C1.1268 5.52887 0.75 4.61096 0.75 3.65386V2.0807C0.75 1.50139 1.21541 1.03177 1.78952 1.03177Z"
									fill="currentColor"
									fill-rule="evenodd"
									clip-rule="evenodd"
								/>
								<path
									d="M4.57719 7.26263C4.37731 6.90243 4.24094 6.50149 4.18336 6.07526L4.17941 6.04498C4.16166 5.90411 4.15251 5.76052 4.15251 5.61478L4.15251 1.10896C4.15251 1.02488 4.24618 0.944783 4.41557 0.871928C4.92375 0.653363 6.11342 0.5 7.49999 0.5C9.34874 0.5 10.8475 0.772637 10.8475 1.10895V5.61478C10.8475 5.77097 10.837 5.9247 10.8166 6.07526C10.7459 6.59904 10.5561 7.0846 10.2758 7.50333C9.6742 8.40183 8.65546 8.99257 7.49999 8.99257L7.47834 8.9925C6.23167 8.98454 5.14668 8.28891 4.57719 7.26263Z"
									fill="currentColor"
									fill-rule="evenodd"
									clip-rule="evenodd"
								/>
								<path
									d="M11.502 7.1645C11.6635 6.74006 11.7606 6.2834 11.7813 5.80672C11.9978 5.69332 12.1978 5.54634 12.3735 5.36908C12.8243 4.91418 13.0775 4.29719 13.0775 3.65386V2.21484H11.8227V1.03177H13.2105C13.7846 1.03177 14.25 1.50139 14.25 2.0807V3.65386C14.25 4.61096 13.8732 5.52887 13.2025 6.20565C12.83 6.58157 12.3836 6.866 11.898 7.04457C11.7686 7.09215 11.6364 7.13221 11.502 7.1645Z"
									fill="currentColor"
									fill-rule="evenodd"
									clip-rule="evenodd"
								/>
								<path
									d="M10.3826 12.1379C10.3826 12.7521 9.09198 13.25 7.49998 13.25C5.90798 13.25 4.6174 12.7521 4.6174 12.1379C4.6174 11.9371 4.75526 11.7488 4.99644 11.5862L4.99892 11.5845L5.54498 11.2735C6.0756 10.9712 6.51643 10.5312 6.82173 9.99911C6.90651 9.85135 7.12539 9.74247 7.49998 9.74247C7.87457 9.74247 8.09345 9.85135 8.17823 9.99911C8.48353 10.5312 8.92435 10.9712 9.45498 11.2735L10.001 11.5845L10.008 11.5893C10.2464 11.7511 10.3826 11.9384 10.3826 12.1379Z"
									fill="currentColor"
									fill-rule="evenodd"
									clip-rule="evenodd"
								/>
							</svg>
							{data.achievements.data.reduce(
								(acc, curr) => acc + curr.totalUnlocked,
								0,
							)}
						</p>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "10px",
							width: "200px",
						}}
					>
						<h2 style={{ fontSize: "22px" }}>Platinum</h2>
						<p
							style={{
								fontSize: "28px",
								fontWeight: "300",
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								gap: "10px",
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 10 15"
								style={{
									width: "23px",
									height: "28px",
								}}
							>
								<path
									fill-rule="evenodd"
									clip-rule="evenodd"
									d="M8.82469 5.7203C8.10017 4.28067 7.34052 2.77122 7.51834 0C6.90611 0.01125 4.43223 1.59312 3.97056 5.34875C3.48704 4.8144 3.24026 3.04552 3.33333 2.32187C1.13777 4.1775 0 6.56 0 9.21813C0 12.4019 1.90556 15 4.97945 15C8.05804 15 10 12.6544 10 9.8275C10 8.05565 9.42438 6.91189 8.82469 5.7203ZM4.99966 13.9598C5.83378 13.9598 6.50997 13.5934 6.50997 13.1415C6.50997 12.8016 6.12752 12.5101 5.58307 12.3865C5.44824 12.0795 5.37724 11.746 5.37724 11.4062C5.37724 11.3212 5.38389 11.237 5.39689 11.1541C6.45872 10.9664 7.2652 10.0392 7.2652 8.92337V7.57032L7.26527 7.56325C7.26527 7.06278 6.25098 6.65707 4.9998 6.65707C3.74862 6.65707 2.73433 7.06278 2.73433 7.56325L2.73427 8.92337C2.73427 10.0391 3.54067 10.9663 4.60242 11.1541C4.61543 11.237 4.62209 11.3212 4.62209 11.4062C4.62209 11.746 4.55109 12.0795 4.41626 12.3865C3.8718 12.5101 3.48935 12.8016 3.48935 13.1415C3.48935 13.5934 4.16554 13.9598 4.99966 13.9598Z"
									fill="currentColor"
								/>
							</svg>
							{data.achievements.data.reduce(
								(acc, curr) => acc + (curr.playerAwards.length ?? 0),
								0,
							)}
						</p>
					</div>

					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "10px",
							width: "200px",
						}}
					>
						<h2 style={{ fontSize: "22px" }}>Library</h2>
						<p
							style={{
								fontSize: "28px",
								fontWeight: "300",
								display: "flex",
								alignItems: "center",
								flexDirection: "row",
								gap: "10px",
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="currentColor"
								class="size-6"
								style={{
									width: "28px",
									height: "28px",
								}}
							>
								<path
									fill-rule="evenodd"
									d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z"
									clip-rule="evenodd"
								/>
							</svg>

							{data.achievements.data.length}
						</p>
					</div>
				</section>
			</div>
		</section>
	);
}

export default app;
