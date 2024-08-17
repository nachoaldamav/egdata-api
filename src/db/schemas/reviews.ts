import mongoose from 'mongoose';

export interface IReview {
  id: string;
  userId: string;
  rating: number;
  content: string;
  title: string;
  tags: string[];
  createdAt: Date;
  verified: boolean;
}

const reviewSchema = new mongoose.Schema<IReview>({
  id: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
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
    maxlength: 100,
  },
  tags: {
    type: [String],
    required: true,
    length: 5,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  verified: {
    type: Boolean,
    required: true,
  },
});

export const Review = mongoose.model('Review', reviewSchema);
