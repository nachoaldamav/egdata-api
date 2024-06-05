import mongoose from 'mongoose';

export const Tags = mongoose.model(
  'Tags',
  new mongoose.Schema(
    {
      id: String,
      name: String,
    },
    { _id: false }
  )
);
