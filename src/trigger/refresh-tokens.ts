import { logger, schedules } from '@trigger.dev/sdk/v3';
import axios from 'axios';

export const refreshTokens = schedules.task({
  id: 'refresh-tokens',
  cron: '*/10 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing Epic Games tokens');
    const res = await axios.patch<{
      status: string;
    }>('https://api.egdata.app/auth/refresh', {
      headers: {
        Authorization: `Bearer ${process.env.JWT_SECRET}`,
      },
    });

    logger.debug(JSON.stringify(res.data));

    if (res.status === 200) {
      logger.log('Epic Games tokens refreshed');
    } else {
      logger.error('Error refreshing Epic Games tokens', res.data);
      throw new Error('Error refreshing Epic Games tokens');
    }
  },
});
