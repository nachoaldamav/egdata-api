import axios from "axios";

export const getDiscordUser = async (token: string) => {
	const discordResponse = await axios.get(
		"https://discord.com/api/v10/oauth2/@me",
		{
			headers: {
				Authorization: `Bearer ${token}`,
			},
		},
	);

	const discordData = discordResponse.data.user;

	if (!discordData) {
		console.error("Discord user data not found");
		return null;
	}

	return discordData as {
		id: string;
		email: string;
		username: string;
		avatar: string;
	};
};
