export interface PlayerProfilePrivateResponse {
  PlayerProfile: {
    playerProfile: {
      privacy: {
        accessLevel: string;
      };
      relationship: string | null;
      achievementsSummaries: AchievementsSummary[];
      friendsSummaries: FriendsSummary;
    };
  };
  ContentControl: {
    get: {
      __typename: string;
    };
  };
  Friends: {
    summary: FriendsSummaryData;
  };
}

interface AchievementsSummary {
  __typename: string;
  status?: string;
  data?: {
    totalUnlocked: number;
    totalXP: number;
    sandboxId: string;
    baseOfferForSandbox: {
      keyImages: {
        url: string;
        type: string;
        alt: string;
      }[];
    };
    product: {
      name: string;
      slug: string;
    };
    productAchievements: {
      totalAchievements: number;
      totalProductXP: number;
    };
    playerAwards: PlayerAward[];
  };
}

interface PlayerAward {
  awardType: string; // Adjust this if there are other fields available
  // Add other valid fields as needed
}

interface FriendsSummary {
  __typename: string;
  status?: string;
  data?: FriendsSummaryData;
}

interface FriendsSummaryData {
  page: number;
  nextPage: number | null;
  previousPage: number | null;
  totalPages: number;
  totalItems: number;
  content: FriendContent[];
}

interface FriendContent {
  epicAccountId: string;
  displayName: string;
  avatar: {
    small: string;
    medium: string;
    large: string;
  };
}

interface FriendsData {
  outgoing: {
    accountId: string;
  }[];
  blocklist: {
    accountId: string;
  }[];
}
