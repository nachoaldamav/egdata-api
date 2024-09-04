import mongoose, { Document, Schema } from "mongoose";

export interface IGoogleAuth extends Document {
  _id: string;
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: Date;
  refresh_expires_at: Date;
  scope: string;
  token_type: string;
  created_at: Date;
}

const GoogleAuthSchema: Schema<IGoogleAuth> = new Schema({
  _id: {
    type: String,
    required: true,
  },
  access_token: {
    type: String,
    required: true,
  },
  refresh_token: {
    type: String,
    required: true,
  },
  id_token: {
    type: String,
    required: true,
  },
  expires_at: {
    type: Date,
    required: true,
  },
  refresh_expires_at: {
    type: Date,
    required: true,
  },
  scope: {
    type: String,
    required: true,
  },
  token_type: {
    type: String,
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

const GoogleAuth = mongoose.model<IGoogleAuth>("GoogleAuth", GoogleAuthSchema);

export default GoogleAuth;
