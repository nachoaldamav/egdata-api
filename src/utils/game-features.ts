const known3rdPartyClients: {
  [key: string]: "ea" | "ubisoft" | "eos" | "epic";
} = {
  ThirdPartyManagedApp: "ea",
  MonitorPresense: "eos",
  PresenceId: "eos",
  parentPartnerLinkType: "ubisoft",
  partnerType: "ubisoft",
  partnerLinkId: "ubisoft",
  partnerLinkType: "ubisoft",
  isUplay: "ubisoft",
};

// TODO: Fetch this data from the DB
const knownGameFeatures = [
  {
    aliases: [],
    id: "27343",
    name: "Alexa Game Control",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 3,
  },
  {
    aliases: [],
    id: "1264",
    name: "Co-op",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 1166,
  },
  {
    aliases: [],
    id: "1299",
    name: "Competitive",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 452,
  },
  {
    aliases: [],
    id: "9549",
    name: "Controller Support",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 2620,
  },
  {
    aliases: [],
    id: "22776",
    name: "Cross Platform",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 574,
  },
  {
    aliases: [],
    id: "1183",
    name: "Local Multiplayer",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 168,
  },
  {
    aliases: [],
    id: "22775",
    name: "MMO",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 256,
  },
  {
    aliases: [],
    id: "1203",
    name: "Multiplayer",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 1846,
  },
  {
    aliases: [],
    id: "29088",
    name: "Online Multiplayer",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 968,
  },
  {
    aliases: [],
    id: "1370",
    name: "Single Player",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 5001,
  },
  {
    aliases: [],
    id: "1179",
    name: "VR",
    status: "ACTIVE",
    groupName: "feature",
    referenceCount: 43,
  },
];

// TODO: Fetch this data from the DB
const knownEpicFeatures = [
  {
    aliases: [],
    id: "19847",
    name: "Achievements",
    status: "ACTIVE",
    groupName: "epicfeature",
    referenceCount: 3711,
  },
  {
    aliases: [],
    id: "21894",
    name: "Cloud Saves",
    status: "ACTIVE",
    groupName: "epicfeature",
    referenceCount: 1804,
  },
];

type GameFeatures = {
  launcher: "epic" | "ea" | "ubisoft" | "eos";
  features: string[];
  epicFeatures: string[];
};

export function getGameFeatures({
  attributes,
  tags,
}: {
  attributes: Record<string, { type: string; value: string }>;
  tags: Record<
    string,
    {
      id: string;
      name: string;
    }
  >;
}) {
  // The launcher is determined in the attributes, the features are determined in the tags
  const gameFeatures: GameFeatures = {
    launcher: "epic",
    features: [],
    epicFeatures: [],
  };

  // Check for the keys in the known3rdPartyClients object
  for (const key in known3rdPartyClients) {
    // The value of the key is useless, we only need to check if the key exists
    if (attributes[key]) {
      if (known3rdPartyClients[key] === "eos") {
        gameFeatures.epicFeatures.push("Epic Online Services");
        continue;
      }
      gameFeatures.launcher = known3rdPartyClients[key];
    }
  }

  // Check for the tags in the knownGameFeatures object
  for (const key in tags) {
    const tag = tags[key];
    const feature = knownGameFeatures.find((f) => f.id === tag.id);
    if (feature) {
      gameFeatures.features.push(feature.name);
    }
  }

  // Check for the tags in the knownEpicFeatures object
  for (const key in tags) {
    const tag = tags[key];
    const feature = knownEpicFeatures.find((f) => f.id === tag.id);
    if (feature) {
      gameFeatures.epicFeatures.push(feature.name);
    }
  }

  return gameFeatures;
}
