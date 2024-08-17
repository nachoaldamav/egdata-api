import { gql, GraphQLClient } from 'graphql-request';
import { PlayerProfileQuery } from '../types/get-epic-user.js';

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
}

export const epicStoreClient = new EpicStoreClient();
