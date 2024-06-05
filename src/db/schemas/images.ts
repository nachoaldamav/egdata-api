import mongoose from 'mongoose';

export const Image = mongoose.model(
  'Image',
  new mongoose.Schema(
    {
      type: { required: true, type: String },
      url: { required: true, type: String },
      md5: { required: true, type: String },
    },
    { _id: false }
  )
);
