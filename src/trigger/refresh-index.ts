import { logger, schedules } from '@trigger.dev/sdk/v3';
import axios from 'axios';

const REFRESH_CHANGELOG_URL = 'https://api.egdata.app/refresh/changelog';
const REFRESH_OFFERS_URL = 'https://api.egdata.app/refresh/offers';
const REFRESH_ITEMS_URL = 'https://api.egdata.app/refresh/items';
const REFRESH_SELLERS_URL = 'https://api.egdata.app/refresh/sellers';

export const refreshChangelogIndex = schedules.task({
  id: 'refresh-changelog-index',
  cron: '*/5 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing MeiliSearch changelog index');
    const res = await axios.patch<{
      status: string;
    }>(REFRESH_CHANGELOG_URL);

    logger.debug(JSON.stringify(res.data));

    if (res.status === 200) {
      logger.log('Changelog index refreshed');
    } else {
      logger.error('Error refreshing changelog index', res.data);
      throw new Error('Error refreshing changelog index');
    }
  },
});

export const refreshOffersIndex = schedules.task({
  id: 'refresh-offers-index',
  cron: '*/5 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing MeiliSearch offers index');
    const res = await axios.patch<{
      status: string;
    }>(REFRESH_OFFERS_URL);

    logger.debug(JSON.stringify(res.data));

    if (res.status === 200) {
      logger.log('Offers index refreshed');
    } else {
      logger.error('Error refreshing offers index', res.data);
      throw new Error('Error refreshing offers index');
    }
  },
});

export const refreshItemsIndex = schedules.task({
  id: 'refresh-items-index',
  cron: '*/5 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing MeiliSearch items index');
    const res = await axios.patch<{
      status: string;
    }>(REFRESH_ITEMS_URL);

    logger.debug(JSON.stringify(res.data));

    if (res.status === 200) {
      logger.log('Items index refreshed');
    } else {
      logger.error('Error refreshing items index', res.data);
      throw new Error('Error refreshing items index');
    }
  },
});

export const refreshSellersIndex = schedules.task({
  id: 'refresh-sellers-index',
  cron: '*/5 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing MeiliSearch sellers index');
    const res = await axios.patch<{
      status: string;
    }>(REFRESH_SELLERS_URL);

    logger.debug(JSON.stringify(res.data));

    if (res.status === 200) {
      logger.log('Sellers index refreshed');
    } else {
      logger.error('Error refreshing sellers index', res.data);
      throw new Error('Error refreshing sellers index');
    }
  },
});
