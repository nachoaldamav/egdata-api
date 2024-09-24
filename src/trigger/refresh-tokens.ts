import { envvars, logger, schedules } from '@trigger.dev/sdk/v3';
import axios from 'axios';

export const refreshTokens = schedules.task({
  id: 'refresh-tokens',
  cron: '*/10 * * * *',
  run: async (payload, { ctx }) => {
    const token = await envvars.retrieve('JWT_SECRET');

    if (!token) {
      logger.error('Missing JWT_SECRET env variable');
      throw new Error('Missing JWT_SECRET env variable');
    }

    logger.log('Refreshing Epic Games tokens', {
      token: `${token.value.substring(0, 5)}...`,
    });

    const res = await fetch('https://api.egdata.app/auth/refresh', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token.value}`,
      },
    });

    if (!res.ok) {
      logger.error('Error refreshing Epic Games tokens', await res.json());
      throw new Error('Error refreshing Epic Games tokens');
    }

    logger.log('Epic Games tokens refreshed');
  },
});