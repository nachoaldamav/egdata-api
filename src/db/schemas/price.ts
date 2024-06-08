import mongoose from 'mongoose';

export const PriceSchema = new mongoose.Schema({
  offerId: { required: true, type: String },
  currency: { required: true, type: String },
  country: { required: true, type: String },
  symbol: { required: true, type: String },
  totalPrice: {
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
  totalPaymentPrice: {
    paymentCurrencyAmount: { required: true, type: Number },
    paymentCurrencyCode: { required: true, type: String },
    paymentCurrencyExchangeRate: { required: true, type: Number },
    paymentCurrencySymbol: { required: true, type: String },
  },
});

export const Price = mongoose.model('Price', PriceSchema);

const PriceHistorySchema = new mongoose.Schema(
  {
    price: { required: true, type: Number },
    date: { required: true, type: Date },
    metadata: {
      id: { required: true, type: String },
      country: { required: true, type: String },
    },
  },
  {
    timeseries: {
      timeField: 'date',
      metaField: 'metadata',
      granularity: 'hours',
    },
  }
);

export const PriceHistory = mongoose.model(
  'price-history',
  PriceHistorySchema,
  'price-history'
);

export type PriceType = mongoose.InferSchemaType<typeof PriceSchema>;
