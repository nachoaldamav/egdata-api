FROM oven/bun:1

WORKDIR /app
COPY . /app

EXPOSE 4000

CMD ["bun", "start"]