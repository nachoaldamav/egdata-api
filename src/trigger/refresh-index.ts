import { logger, schedules } from "@trigger.dev/sdk/v3";
import axios from "axios";

const REFRESH_CHANGELOG_URL = "https://api.egdata.app/refresh/changelog";
const REFRESH_OFFERS_URL = "https://api.egdata.app/refresh/offers";
const REFRESH_ITEMS_URL = "https://api.egdata.app/refresh/items";
const REFRESH_SELLERS_URL = "https://api.egdata.app/refresh/sellers";
const REFRESH_FREE_GAMES_URL = "https://api.egdata.app/free-games/index";

export const refreshChangelog = schedules.task({
  id: "refresh-changelog",
  cron: "*/30 * * * *", // Every 30 minutes
  run: async (payload, { ctx }) => {
    logger.log("Refreshing changelog");
    await axios.patch(REFRESH_CHANGELOG_URL);
    logger.log("Changelog refreshed");
  },
});

export const refreshOffers = schedules.task({
  id: "refresh-offers",
  cron: "*/5 * * * *", // Every 5 minutes
  run: async (payload, { ctx }) => {
    logger.log("Refreshing offers");
    await axios.patch(REFRESH_OFFERS_URL);
    logger.log("Offers refreshed");
  },
});

export const refreshItems = schedules.task({
  id: "refresh-items",
  cron: "*/5 * * * *", // Every 5 minutes
  run: async (payload, { ctx }) => {
    logger.log("Refreshing items");
    await axios.patch(REFRESH_ITEMS_URL);
    logger.log("Items refreshed");
  },
});

export const refreshSellers = schedules.task({
  id: "refresh-sellers",
  cron: "*/5 * * * *", // Every 5 minutes
  run: async (payload, { ctx }) => {
    logger.log("Refreshing sellers");
    await axios.patch(REFRESH_SELLERS_URL);
    logger.log("Sellers refreshed");
  },
});

export const refreshFreeGames = schedules.task({
  id: "refresh-free-games",
  cron: "*/20 * * * *", // Every 20 minutes
  run: async (payload, { ctx }) => {
    logger.log("Refreshing free games");
    await axios.patch(REFRESH_FREE_GAMES_URL);
    logger.log("Free games refreshed");
  },
});
