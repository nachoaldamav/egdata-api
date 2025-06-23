import type { WithRequired } from '@apollo/utils.withrequired';
import type {
    ApolloServer,
    BaseContext,
    ContextFunction,
    HTTPGraphQLRequest,
} from '@apollo/server';
import type { Context, MiddlewareHandler } from 'hono';
import { HeaderMap } from '@apollo/server';

/** ──── Types ────────────────────────────────────────────────────────────── */

export interface HonoContextFunctionArgument {
    /** The Hono context, giving you raw Request/Response if you need them */
    c: Context;
}

export interface HonoMiddlewareOptions<TContext extends BaseContext> {
    /**
     * Build your GraphQL context from the Hono context.
     * (Exactly like the Express version, just with `c` instead of `req`, `res`.)
     */
    context?: ContextFunction<[HonoContextFunctionArgument], TContext>;
}

/** ──── Middleware factory ───────────────────────────────────────────────── */
export function honoMiddleware(
    server: ApolloServer<BaseContext>,
    options?: HonoMiddlewareOptions<BaseContext>,
): MiddlewareHandler;

export function honoMiddleware<TContext extends BaseContext>(
    server: ApolloServer<TContext>,
    options: WithRequired<HonoMiddlewareOptions<TContext>, 'context'>,
): MiddlewareHandler;

export function honoMiddleware<TContext extends BaseContext>(
    server: ApolloServer<TContext>,
    options?: HonoMiddlewareOptions<TContext>,
): MiddlewareHandler {
    server.assertStarted('honoMiddleware()');

    const defaultContext: ContextFunction<[HonoContextFunctionArgument], BaseContext> =
        async () => ({});
    const context =
        options?.context ?? (defaultContext as unknown as ContextFunction<
            [HonoContextFunctionArgument],
            TContext
        >);

    /** Actual Hono middleware (handler) */
    return async (c: Context): Promise<Response> => {
        // 1️⃣ Build the HTTPGraphQLRequest --------------------------------------
        const rawReq = c.req.raw; // Native Fetch Request

        const headers = new HeaderMap();
        rawReq.headers.forEach((value, key) => headers.set(key, value));

        let body: unknown = undefined;
        // Hono gives you helpers for the common body types. We only attempt JSON.
        if (rawReq.method !== 'GET' && rawReq.body) {
            try {
                body = await c.req.json();
            } catch {
                // probably not JSON – leave undefined and let Apollo handle it
            }
        }

        const { search } = new URL(rawReq.url, 'http://localhost'); // base needed only for Node

        const httpGraphQLRequest: HTTPGraphQLRequest = {
            method: rawReq.method.toUpperCase(),
            headers,
            search,
            body,
        };

        // 2️⃣ Let Apollo do its thing -------------------------------------------
        const httpGraphQLResponse = await server.executeHTTPGraphQLRequest({
            httpGraphQLRequest,
            context: () => context({ c }),
        });

        // 3️⃣ Convert Apollo's response back to Fetch Response ------------------
        const responseHeaders = Object.fromEntries(httpGraphQLResponse.headers);

        // ── Non-streaming responses (“complete”) ───────────────────────────────
        if (httpGraphQLResponse.body.kind === 'complete') {
            return new Response(httpGraphQLResponse.body.string, {
                status: httpGraphQLResponse.status ?? 200,
                headers: responseHeaders,
            });
        }

        // ── Streaming responses (“chunked”) ────────────────────────────────────
        const chunkedBody = httpGraphQLResponse.body;
        const stream = new ReadableStream({
            async start(controller) {
                for await (const chunk of chunkedBody.asyncIterator) {
                    controller.enqueue(
                        typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
                    );
                }
                controller.close();
            },
        });

        return new Response(stream, {
            status: httpGraphQLResponse.status ?? 200,
            headers: responseHeaders,
        });
    };
}