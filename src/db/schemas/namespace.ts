import mongoose from "mongoose";

export const Namespace = mongoose.model(
  "Namespace",
  new mongoose.Schema({
    _id: { required: true, type: String },
    namespace: { required: true, type: String },
  }),
);
