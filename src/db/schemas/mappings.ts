import mongoose from "mongoose";

const MappingArray = new mongoose.Schema(
	{
		pageSlug: { type: String, required: true },
		pageType: { type: String, required: true },
		productId: { type: String, required: true },
		sandboxId: { type: String, required: true },
		updatedDate: { type: Date, required: true },
	},
	{
		_id: false,
	},
);

export const Mappings = mongoose.model(
	"Mappings",
	new mongoose.Schema({
		_id: { type: String, required: true },
		namespace: { type: String, required: true },
		displayName: { type: String, required: true },
		parent: { type: String, required: false },
		mappings: { type: [MappingArray], required: true },
	}),
);

export type MappingsType = mongoose.InferSchemaType<typeof Mappings>;
