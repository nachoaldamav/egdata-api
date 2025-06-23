import { ApolloServer } from "@apollo/server";
import { typeDefs } from "./typedefs.js";
import offers from "./resolvers/offer.js";
import type { Connection } from "mongoose";
import type { ConsolaInstance } from "consola";
import { GraphQLDateTime } from 'graphql-scalars';

const resolvers = {
    Date: GraphQLDateTime
};

export type Context = {
    db: Connection
    logger: ConsolaInstance
}

export const server = new ApolloServer<Context>({
    typeDefs,
    resolvers: [offers, resolvers],
});