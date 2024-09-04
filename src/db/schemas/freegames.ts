import mongoose from "mongoose";

const FreeGamesSchema = new mongoose.Schema({
  id: { type: String, required: true },
  namespace: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
});

export const FreeGames = mongoose.model("FreeGames", FreeGamesSchema);
