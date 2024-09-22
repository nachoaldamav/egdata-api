# Use Bun as the base image
FROM oven/bun:1 AS base

# Install curl
USER root
RUN apt-get update && apt-get install -y curl

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Set shell to bash
SHELL ["/bin/bash", "-c"]
RUN curl -fsSL https://get.pnpm.io/install.sh | sh -

# Set the working directory
WORKDIR /app

# Copy only package files for caching
COPY package.json pnpm-lock.yaml ./

# Install production dependencies
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# Create the final runtime image
FROM base
COPY --from=prod-deps /app/ ./

# Expose the application port
EXPOSE 4000

# Run the application using Bun
CMD ["bun", "run", "src/index.ts"]
