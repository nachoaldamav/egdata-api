export interface PlayerProfileAchievementsByProductIdQuery {
	PlayerProfile: PlayerProfileAchievementsByProductId_PlayerProfile | null;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile {
	playerProfile: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile | null;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile {
	epicAccountId: string;
	displayName: string;
	relationship: string;
	avatar: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_avatar | null;
	productAchievements: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements | null;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_avatar {
	small: string;
	medium: string;
	large: string;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements {
	__typename: string;
	data: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data | null;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data {
	epicAccountId: string;
	sandboxId: string;
	totalXP: number;
	totalUnlocked: number;
	achievementSets: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_achievementSets[];
	playerAwards: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_playerAwards[];
	playerAchievements: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_playerAchievements[];
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_achievementSets {
	achievementSetId: string;
	isBase: boolean;
	totalUnlocked: number;
	totalXP: number;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_playerAwards {
	awardType: string;
	unlockedDateTime: string;
	achievementSetId: string;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_playerAchievements {
	playerAchievement: PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_playerAchievements_playerAchievement | null;
}

export interface PlayerProfileAchievementsByProductId_PlayerProfile_playerProfile_productAchievements_data_playerAchievements_playerAchievement {
	achievementName: string;
	epicAccountId: string;
	progress: number;
	sandboxId: string;
	unlocked: boolean;
	unlockDate: string;
	XP: number;
	achievementSetId: string;
	isBase: boolean;
}

export interface PlayerProfileAchievementsByProductIdQueryVariables {
	epicAccountId: string;
	productId: string;
}
