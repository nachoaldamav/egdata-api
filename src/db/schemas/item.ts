import mongoose from 'mongoose';
import { Image } from './images.js';

const CustomAttributeSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false }
);

const ItemSchema = new mongoose.Schema({
  _id: { required: true, type: String },
  id: { required: true, type: String },
  namespace: { required: true, type: String },
  title: { required: true, type: String },
  description: { required: true, type: String },
  keyImages: [Image.schema],
  categories: [{ path: String }],
  status: { required: true, type: String },
  creationDate: { required: true, type: Date },
  lastModifiedDate: { required: true, type: Date },
  customAttributes: {
    type: Map,
    of: CustomAttributeSchema,
    required: false,
  },
  entitlementName: { required: true, type: String },
  entitlementType: { required: true, type: String },
  itemType: { required: true, type: String },
  releaseInfo: [{ id: String, appId: String, platform: [String] }],
  developer: { required: true, type: String },
  developerId: { required: true, type: String },
  eulaIds: [String],
  installModes: [String],
  endOfSupport: { required: true, type: Boolean },
  selfRefundable: { type: Boolean },
  applicationId: { type: String },
  unsearchable: { required: true, type: Boolean },
  requiresSecureAccount: { type: Boolean },
  entitlementEndDate: { type: Date },
  useCount: { type: Number },
  entitlementStartDate: { type: Date },
  longDescription: { type: String },
  technicalDetails: { type: String },
});

ItemSchema.index({ id: 1 }, { unique: true });
ItemSchema.index({ namespace: 1 });
ItemSchema.index({ title: 1 });
ItemSchema.index({ categories: 1 });
ItemSchema.index({ status: 1 });
ItemSchema.index({ creationDate: 1 });
ItemSchema.index({ lastModifiedDate: 1 });
ItemSchema.index({ 'customAttributes.$**': 1 });
ItemSchema.index({ euiaIds: 1 });
ItemSchema.index({ unsearchable: 1 });

export const Item = mongoose.model('Item', ItemSchema);
