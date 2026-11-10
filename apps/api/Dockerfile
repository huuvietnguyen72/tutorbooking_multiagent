# syntax=docker/dockerfile:1

FROM node:20.18.1-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN npm ci
COPY apps/api ./apps/api
RUN npm run build --workspace @tutor/api

FROM node:20.18.1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TZ=UTC \
    PORT=3000
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
WORKDIR /app/apps/api
EXPOSE 3000
# Migrate, seed (idempotent), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed/main.js && exec node dist/main.js"]
