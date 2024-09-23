import { logger, schedules } from '@trigger.dev/sdk/v3';

export const refreshIndex = schedules.task({
  id: 'refresh-index',
  cron: '*/5 * * * *',
  run: async (payload, { ctx }) => {
    logger.log('Refreshing index');
    const res = await fetch('https://api.egdata.org/refresh-index', {
      method: 'PATCH',
    })
      .then((res) => res)
      .catch((err) => {
        logger.error(err);
        return err;
      });

    if (res.ok) {
      logger.log('Index refreshed');
    } else {
      logger.error('Error refreshing index', res);
    }
  },
});
