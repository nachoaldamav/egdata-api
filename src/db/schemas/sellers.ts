import mongoose from "mongoose";

const logoSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  url: { type: String, required: true },
  height: { type: Number, required: false },
  width: { type: Number, required: false },
  checksum: { type: String, required: true },
  animated: { type: Boolean, required: false },
  alpha_channel: { type: Boolean, required: false },
});

const SellerSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  igdb_id: { type: Number, required: false },
  logo: { type: logoSchema, required: false },
  website: { type: String, required: false },
  createdAt: { type: Date, required: true, default: Date.now },
  updatedAt: { type: Date, required: true, default: Date.now },
});

export const Seller = mongoose.model("Seller", SellerSchema);
