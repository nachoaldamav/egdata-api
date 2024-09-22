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

RUN pnpm env use --global lts

COPY . /app
WORKDIR /app

FROM base
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=build /app/src /app/src
# Start the server
CMD ["bun", "run", "src/index.ts"]