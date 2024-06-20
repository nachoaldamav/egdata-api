import mongoose from 'mongoose';

const assetSchema = new mongoose.Schema({
  artifactId: { required: true, type: String },
  downloadSizeBytes: { required: true, type: Number },
  installedSizeBytes: { required: true, type: Number },
  itemId: { required: true, type: String },
  namespace: { required: true, type: String },
  platform: { required: true, type: String },
});

export const Asset = mongoose.model('Asset', assetSchema);
export type AssetType = mongoose.InferSchemaType<typeof assetSchema>;