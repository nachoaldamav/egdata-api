import mongoose from "mongoose";

// Define the Event Schema
const eventSchema = new mongoose.Schema({
	event: { type: String, required: true },
	location: { type: String, required: true },
	params: { type: Object, required: true },
	userId: { type: String, required: true },
	session: { type: String, required: true },
	timestamp: { type: Date, default: Date.now },
});

// Define the Rank Schema
const rankSchema = new mongoose.Schema({
	offerId: { type: String, required: true, unique: true },
	rankScore: { type: Number, default: 0 },
});

// Create the Models
const Event = mongoose.model("Event", eventSchema);
const Rank = mongoose.model("Rank", rankSchema);

export { Event, Rank };
