# syntax=docker/dockerfile:1

FROM node:20.19.5-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
# workspaces resolve the api deps too; argon2 compiles natively.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci \
    && apk del .build-deps
COPY apps/web ./apps/web
RUN npm run build --workspace @tutor/web

FROM nginxinc/nginx-unprivileged:1.27.3-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
