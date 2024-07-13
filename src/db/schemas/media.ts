import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  src: { type: String, required: true },
});

const videoSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  outputs: [
    {
      duration: { type: Number, required: true },
      url: { type: String, required: true },
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      key: { type: String, required: true },
      contentType: { type: String, required: true },
    },
  ],
});

const MediaSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  namespace: { type: String, required: true },
  images: [{ type: imageSchema }],
  videos: [{ type: videoSchema }],
  logo: { type: String, required: false },
});

export const Media = mongoose.model('Media', MediaSchema);
