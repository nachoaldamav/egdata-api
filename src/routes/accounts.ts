import { Hono } from "hono";
import { jwtMiddleware } from "../middlewares/jwt";
import { decrypt } from "../utils/tokens";
import GoogleAuth from "../db/schemas/google-auth";

const app = new Hono();

app.use(jwtMiddleware);

app.get("/", async (c) => {
	const user = c.get("user") as { id: string };

	const id = decrypt(user.id);

	const googleInfo = await GoogleAuth.findOne({ _id: id });

	if (!googleInfo) {
		return c.json({ error: "User not found" }, 403);
	}

	const googleAccountUrl = new URL(
		"https://www.googleapis.com/oauth2/v3/userinfo",
	);

	const response = await fetch(googleAccountUrl.toString(), {
		method: "GET",
		headers: {
			Authorization: `Bearer ${googleInfo.access_token}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
	});

	const data = await response.json();

	if (response.status !== 200) {
		console.error(`Failed to get account info`, data);
		return c.json(
			{ error: "Failed to get account info", details: data },
			{
				status: response.status,
				statusText: response.statusText,
			},
		);
	}

	return c.json({
		data,
	});
});

export default app;
