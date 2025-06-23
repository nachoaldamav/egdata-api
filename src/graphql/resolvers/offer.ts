import { Offer, type OfferType } from '@egdata/core.schemas.offers';
import type { IResolvers } from '@graphql-tools/utils';
import type { Context } from '../index.js';
import { buildProjection } from '../../utils/projection.js';

const resolvers: IResolvers<OfferType, Context> = {
    Query: {
        offer: async (_, { id }, context, info) => {
            const projection = buildProjection(info, 'Offer');
            return Offer.findOne({ id }, projection).lean();
        },
    },
};

export default resolvers;