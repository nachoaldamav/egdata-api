import mongoose from "mongoose";

const offerPriceSchema = new mongoose.Schema({
  currencyCode: { required: true, type: String },
  discount: { required: true, type: Number },
  discountPrice: { required: true, type: Number },
  originalPrice: { required: true, type: Number },
  basePayoutCurrencyCode: { required: true, type: String },
  basePayoutPrice: { required: true, type: Number },
  payoutCurrencyExchangeRate: { required: true, type: Number },
});

const discountSettingSchema = new mongoose.Schema({
  discountType: { required: true, type: String },
  discountValue: { required: false, type: Number },
  discountPercentage: { required: false, type: Number },
});

const promotionSettingSchema = new mongoose.Schema({
  promotionType: { required: true, type: String },
  discountOffers: {
    required: false,
    type: [
      {
        offerId: { required: true, type: String },
      },
    ],
  },
});

const appliedRulesSchema = new mongoose.Schema({
  id: { required: true, type: String },
  name: { required: true, type: String },
  namespace: { required: true, type: String },
  promotionStatus: { required: true, type: String },
  startDate: { required: true, type: Date },
  endDate: { required: true, type: Date },
  saleType: { required: true, type: String },
  regionIds: { required: true, type: [String] },
  discountSetting: { required: true, type: discountSettingSchema },
  promotionSetting: { required: true, type: promotionSettingSchema },
});

const priceEngineSchema = new mongoose.Schema({
  country: { required: true, type: String },
  region: { required: true, type: String },
  namespace: { required: true, type: String },
  offerId: { required: true, type: String },
  price: { required: true, type: offerPriceSchema },
  appliedRules: { required: true, type: [appliedRulesSchema] },
  updatedAt: { required: true, type: Date, default: Date.now },
});

export const PriceEngine = mongoose.model(
  "PriceEngine",
  priceEngineSchema,
  "pricev2",
);

export const PriceEngineHistorical = mongoose.model(
  "PriceEngineHistorical",
  priceEngineSchema,
  "pricev2_historical",
);

export type PriceType = mongoose.InferSchemaType<typeof priceEngineSchema>;
