import { Client } from '@opensearch-project/opensearch';

export const opensearch = new Client({
    node: process.env.OPENSEARCH_URL as string,
    auth: {
        username: process.env.OPENSEARCH_USERNAME as string,
        password: process.env.OPENSEARCH_PASSWORD as string,
    },
});