import { logger, schedules } from '@trigger.dev/sdk/v3';
import axios from 'axios';

const REFRESH_CHANGELOG_URL = 'https://api.egdata.app/refresh/changelog';
const REFRESH_OFFERS_URL = 'https://api.egdata.app/refresh/offers';
const REFRESH_ITEMS_URL = 'https://api.egdata.app/refresh/items';
const REFRESH_SELLERS_URL = 'https://api.egdata.app/refresh/sellers';

export const refreshIndexes = schedules.task({
  id: 'refresh-indexes',
  cron: '*/5 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing indexes');
    await Promise.allSettled([
      axios.patch(REFRESH_CHANGELOG_URL),
      axios.patch(REFRESH_OFFERS_URL),
      axios.patch(REFRESH_ITEMS_URL),
      axios.patch(REFRESH_SELLERS_URL),
    ]);

    logger.log('Indexes refreshed');
  },
});
