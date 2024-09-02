import { epicStoreClient } from "../clients/epic.js";

export const verifyGameOwnership = async (
	accountId: string,
	productId: string,
) => {
	const user = await epicStoreClient.getUser(accountId);

	if (!user) {
		return false;
	}

	const productAchievements = await epicStoreClient.getUserProductAchievements(
		accountId,
		productId,
	);

	if (
		productAchievements?.__typename === "ServiceError" ||
		!productAchievements ||
		productAchievements.data?.playerAchievements?.length === 0
	) {
		return false;
	}

	return true;
};
