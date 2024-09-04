import mongoose from "mongoose";

export interface IUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  epicId: string | null;
  registrationDate: Date;
}

const userSchema = new mongoose.Schema<IUser>({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  displayName: {
    type: String,
    required: true,
  },
  avatarUrl: {
    type: String,
    required: true,
  },
  epicId: {
    type: String,
    required: false,
    unique: true,
  },
  registrationDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
});

export const User = mongoose.model("User", userSchema);
