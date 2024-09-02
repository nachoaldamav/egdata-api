import mongoose from "mongoose";

export const Achievement = new mongoose.Schema(
	{
		deploymentId: { required: true, type: String },
		name: { required: true, type: String },
		flavorText: { required: false, type: String },
		hidden: { required: true, type: Boolean },

		unlockedDisplayName: { required: true, type: String },
		unlockedDescription: { required: true, type: String },
		unlockedIconId: { required: true, type: String },
		unlockedIconLink: { required: true, type: String },

		lockedDisplayName: { required: true, type: String },
		lockedDescription: { required: true, type: String },
		lockedIconId: { required: true, type: String },
		lockedIconLink: { required: true, type: String },

		xp: { required: true, type: Number },
		completedPercent: { required: true, type: Number }, // rarity.percent (0.0 - 100.0)
	},
	{ _id: false },
);

export const AchievementSet = mongoose.model(
	"AchievementSet",
	new mongoose.Schema(
		{
			_id: { required: true, type: String },
			productId: { required: true, type: String },
			sandboxId: { required: true, type: String },
			achievementSetId: { required: true, type: String },
			isBase: { required: true, type: Boolean },
			numProgressed: { required: true, type: Number },
			numCompleted: { required: true, type: Number },
			achievements: [Achievement],
		},
		{ _id: false },
	),
);
export type AchievementType = mongoose.InferSchemaType<typeof Achievement>;
