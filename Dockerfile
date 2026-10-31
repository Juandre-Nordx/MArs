FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run db:generate && npm run build
ENV NODE_ENV=production
ENV WEB_ROOT=/app/apps/web/dist
ENV PORT=3001
EXPOSE 3001
CMD ["sh", "-c", "npm run db:migrate && npm run start -w @mars/api"]
