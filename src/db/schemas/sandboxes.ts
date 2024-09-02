import mongoose from "mongoose";

const SandboxSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	namespaceType: { type: String, required: true },
	accessType: { type: String, required: true },
	defaultPublic: { type: Boolean, required: false },
	store: { type: String, required: true },
	parent: { type: String, required: true },
	name: { type: String, required: true },
	merchantGroup: { type: String, required: true },
	taxSkuId: { type: String, required: false },
	eulaIds: { type: [String], required: false },
	displayName: { type: String, required: false },
	addVatToPrice: { type: Boolean, required: false },
	priceTierType: { type: String, required: false },
	convenienceFee: { type: Boolean, required: false },
	status: { type: String, required: false },
	ratingAgeGating: {
		ACB: { type: Number, required: false },
		PEGI: { type: Number, required: false },
		ClassInd: { type: Number, required: false },
		OFLC: { type: Number, required: false },
		USK: { type: Number, required: false },
		GRAC: { type: Number, required: false },
		ESRB: { type: Number, required: false },
	},
	ageGatings: { type: Object, required: false },
	slug: { type: String, required: false },
	ageGated: { type: Boolean, required: false },
	created: { type: Date, required: true },
	updated: { type: Date, required: true },
	countriesBlacklist: { type: [String], required: false },
});

export const Sandbox = mongoose.model("Sandbox", SandboxSchema);
export type SandboxType = typeof Sandbox;
