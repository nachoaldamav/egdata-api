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

const TagSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, required: true },
  groupName: { type: String, required: true },
  aliases: { type: [String], required: true },
});

export const TagModel = mongoose.model('Tag', TagSchema);
