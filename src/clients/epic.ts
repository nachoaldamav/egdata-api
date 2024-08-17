import { gql, GraphQLClient } from 'graphql-request';
import { PlayerProfileQuery } from '../types/get-epic-user.js';
import { PlayerProfileAchievementsByProductIdQuery } from '../types/get-user-product-achievements.js';

export class EpicStoreClient {
  private client: GraphQLClient;

  constructor() {
    this.client = new GraphQLClient('https://store.epicgames.com/graphql');
  }

  async getUser(accountId: string) {
    const query = gql`
      query playerProfile($epicAccountId: String!) {
        PlayerProfile {
          playerProfile(epicAccountId: $epicAccountId) {
            epicAccountId
            displayName
            avatar {
              small
              medium
              large
            }
          }
        }
      }
    `;

    this.client.setHeader(
      'User-Agent',
      'EpicGames/16.11.0-35427934+++Portal+Release-Live-Windows'
    );

    try {
      const data = await this.client.request<PlayerProfileQuery>(query, {
        epicAccountId: accountId,
      });
      return data.PlayerProfile?.playerProfile;
    } catch (err) {
      console.error('Error fetching Epic user data', err);
      return null;
    }
  }

  async getUserProductAchievements(accountId: string, productId: string) {
    const query = gql`
      query playerProfileAchievementsByProductId(
        $epicAccountId: String!
        $productId: String!
      ) {
        PlayerProfile {
          playerProfile(epicAccountId: $epicAccountId) {
            epicAccountId
            displayName
            relationship
            avatar {
              small
              medium
              large
            }
            productAchievements(productId: $productId) {
              __typename
              ... on PlayerProductAchievementsResponseSuccess {
                data {
                  epicAccountId
                  sandboxId
                  totalXP
                  totalUnlocked
                  achievementSets {
                    achievementSetId
                    isBase
                    totalUnlocked
                    totalXP
                  }
                  playerAwards {
                    awardType
                    unlockedDateTime
                    achievementSetId
                  }
                  playerAchievements {
                    playerAchievement {
                      achievementName
                      epicAccountId
                      progress
                      sandboxId
                      unlocked
                      unlockDate
                      XP
                      achievementSetId
                      isBase
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    this.client.setHeader(
      'User-Agent',
      'EpicGames/16.11.0-35427934+++Portal+Release-Live-Windows'
    );

    try {
      const data =
        await this.client.request<PlayerProfileAchievementsByProductIdQuery>(
          query,
          {
            epicAccountId: accountId,
            productId,
          }
        );
      return data.PlayerProfile?.playerProfile?.productAchievements;
    } catch (err) {
      console.error('Error fetching Epic user data', err);
      return null;
    }
  }
}

export const epicStoreClient = new EpicStoreClient();
