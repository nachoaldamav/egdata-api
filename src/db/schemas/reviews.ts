import mongoose from 'mongoose';

export interface IReview {
  id: string;
  userId: string;
  rating: number;
  recommended: boolean;
  content: string;
  title: string;
  tags: string[];
  createdAt: Date;
  verified: boolean;
  updatedAt: Date;
  editions?: {
    title: string;
    content: string;
    createdAt: Date;
    rating: number;
    tags: string[];
    recommended: boolean;
  }[];
}

const reviewSchema = new mongoose.Schema<IReview>({
  id: {
    type: String,
    required: true,
    unique: false,
  },
  userId: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    max: 10,
    min: 1,
  },
  recommended: {
    type: Boolean,
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxlength: 5000,
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
  },
  tags: {
    type: [String],
    required: true,
    length: 5,
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  verified: {
    type: Boolean,
    required: true,
    default: false,
  },
  editions: {
    type: [
      {
        title: String,
        content: String,
        createdAt: Date,
        rating: Number,
        tags: [String],
      },
    ],
    required: false,
  },
});

export const Review = mongoose.model('Review', reviewSchema);
