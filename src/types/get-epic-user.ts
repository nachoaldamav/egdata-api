export interface PlayerProfileQuery {
  PlayerProfile: PlayerProfile | null;
}

export interface PlayerProfile {
  playerProfile: PlayerProfile_playerProfile | null;
}

export interface PlayerProfile_playerProfile {
  epicAccountId: string;
  displayName: string;
  avatar: PlayerProfile_playerProfile_avatar | null;
}

export interface PlayerProfile_playerProfile_avatar {
  small: string;
  medium: string;
  large: string;
}

export interface PlayerProfileQueryVariables {
  epicAccountId: string;
}
