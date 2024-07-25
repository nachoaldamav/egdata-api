FROM node:22-alpine3.19

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apk --no-cache add curl

WORKDIR /app
COPY . /app

RUN pnpm install --frozen-lockfile

RUN pnpm build

EXPOSE 4000

CMD ["pnpm", "start"]