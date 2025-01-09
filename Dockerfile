FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY . /app
WORKDIR /app

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm sea

FROM base AS runner
RUN apt-get update && apt-get install -y curl
WORKDIR /app
COPY --from=build /app/ /app/
EXPOSE 4000

CMD [ "node", "dist/index.cjs" ]