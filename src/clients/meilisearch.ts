import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({
  host: process.env.MEILISEARCH_INSTANCE || 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_API_KEY || '',
});

export { client as meiliSearchClient };
