import mongoose from "mongoose";

const CollectionOfferSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  position: {
    type: Number,
    required: true,
  },
  timesInTop1: {
    type: Number,
    required: false,
  },
  timesInTop5: {
    type: Number,
    required: false,
  },
  timesInTop10: {
    type: Number,
    required: false,
  },
  timesInTop20: {
    type: Number,
    required: false,
  },
  timesInTop50: {
    type: Number,
    required: false,
  },
  timesInTop100: {
    type: Number,
    required: false,
  },
});

const CollectionsSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    required: true,
  },
  updatedAt: {
    type: Date,
    required: true,
  },
  offers: {
    type: [CollectionOfferSchema],
    required: true,
  },
});

export const CollectionOffer = mongoose.model(
  "CollectionOffer",
  CollectionsSchema,
  "collections",
);

export type CollectionOfferType = mongoose.InferSchemaType<
  typeof CollectionOfferSchema
>;
