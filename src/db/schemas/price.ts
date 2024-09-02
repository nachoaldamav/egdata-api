import mongoose from "mongoose";

const totalPriceSchema = new mongoose.Schema(
	{
		basePayoutCurrencyCode: { required: true, type: String },
		basePayoutPrice: { required: true, type: Number },
		convenienceFee: { required: true, type: Number },
		currencyCode: { required: true, type: String },
		discount: { required: true, type: Number },
		discountPrice: { required: true, type: Number },
		originalPrice: { required: true, type: Number },
		vat: { required: true, type: Number },
		voucherDiscount: { required: true, type: Number },
	},
	{ _id: false },
);

const totalPaymentPriceSchema = new mongoose.Schema(
	{
		paymentCurrencyAmount: { required: true, type: Number },
		paymentCurrencyCode: { required: true, type: String },
		paymentCurrencyExchangeRate: { required: true, type: Number },
		paymentCurrencySymbol: { required: true, type: String },
	},
	{ _id: false },
);

export const Price = mongoose.model(
	"Price",
	new mongoose.Schema({
		offerId: { required: true, type: String },
		currency: { required: true, type: String },
		country: { required: true, type: String },
		symbol: { required: true, type: String },
		totalPrice: { required: true, type: totalPriceSchema },
		totalPaymentPrice: { required: true, type: totalPaymentPriceSchema },
	}),
);

const PriceHistorySchema = new mongoose.Schema({
	date: { required: true, type: Date },
	totalPaymentPrice: { required: true, type: totalPaymentPriceSchema },
	totalPrice: { required: true, type: totalPriceSchema },
	metadata: {
		id: { required: true, type: String },
		country: { required: true, type: String },
		region: { required: true, type: String },
	},
});

export const PriceHistory = mongoose.model(
	"PriceHistory",
	PriceHistorySchema,
	"PriceHistory",
);

export const Sales = mongoose.model("sales", PriceHistorySchema, "sales");

export type PriceHistoryType = mongoose.InferSchemaType<
	typeof PriceHistorySchema
>;
