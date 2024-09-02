import mongoose from "mongoose";

const changeSchema = new mongoose.Schema(
	{
		changeType: { required: true, type: String },
		field: { required: true, type: String },
		oldValue: mongoose.Schema.Types.Mixed,
		newValue: mongoose.Schema.Types.Mixed,
	},
	{ _id: false },
);

const metaSchema = new mongoose.Schema(
	{
		contextType: { required: true, type: String },
		contextId: { required: true, type: String },
		changes: [changeSchema],
	},
	{ _id: false },
);

const changelistSchema = new mongoose.Schema(
	{
		timestamp: { required: true, type: Date },
		metadata: { required: true, type: metaSchema },
	},
	{
		collection: "changelogs_v2",
	},
);

export const Changelog = mongoose.model("Changelog", changelistSchema);
export type ChangelogType = mongoose.InferSchemaType<typeof changelistSchema>;
