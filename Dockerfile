# Use Bun as the base image
FROM oven/bun:1 AS base

# Install curl
USER root
RUN apt-get update && apt-get install -y curl

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Set shell to bash
ENV SHELL="/bin/bash"
RUN curl -fsSL https://get.pnpm.io/install.sh | bash -

COPY . /app
WORKDIR /app

# Install production dependencies
FROM base AS prod-deps
RUN pnpm env use --global lts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# RUN pnpm run build

FROM base
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/src /app/src
# Start the server
CMD ["bun", "run", "src/index.ts"]