import mongoose from "mongoose";

const EpicAuthSchema = new mongoose.Schema({
	_id: {
		type: String,
		required: true,
	},
	scope: {
		type: String,
		required: true,
	},
	token_type: {
		type: String,
		required: true,
	},
	access_token: {
		type: String,
		required: true,
	},
	refresh_token: {
		type: String,
		required: true,
	},
	expires_in: {
		type: Number,
		required: true,
	},
	expires_at: {
		type: Date,
		required: true,
	},
	refresh_expires_in: {
		type: Number,
		required: true,
	},
	refresh_expires_at: {
		type: Date,
		required: true,
	},
	account_id: {
		type: String,
		required: true,
	},
	client_id: {
		type: String,
		required: true,
	},
	application_id: {
		type: String,
		required: true,
	},
	acr: {
		type: String,
		required: true,
	},
	auth_time: {
		type: Date,
		required: true,
	},
});

const EpicAuth = mongoose.model("EpicAuth", EpicAuthSchema);

export { EpicAuth, EpicAuthSchema };
