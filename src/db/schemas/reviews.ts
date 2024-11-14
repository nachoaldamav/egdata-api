import mongoose, { Schema, type Document } from 'mongoose';
import type { JSONContent } from '@tiptap/core';

export interface IReview extends Document {
  id: string;
  userId: string;
  rating: number;
  recommended: boolean;
  content: string | JSONContent;
  title: string;
  tags: string[];
  createdAt: Date;
  verified: boolean;
  updatedAt: Date;
  editions?: {
    title: string;
    content: string | JSONContent;
    createdAt: Date;
    rating: number;
    tags: string[];
    recommended: boolean;
  }[];
}

const reviewSchema = new Schema<IReview>({
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
    type: Schema.Types.Mixed, // Allows string or JSON
    required: true,
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
  },
  tags: {
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length <= 5,
      message: 'Tags array should contain at most 5 elements.',
    },
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
        recommended: Boolean,
      },
    ],
    required: false,
  },
});

export const Review = mongoose.model<IReview>('Review', reviewSchema);
