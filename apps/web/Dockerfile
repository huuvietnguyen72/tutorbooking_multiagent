# syntax=docker/dockerfile:1

FROM node:20.18.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build --workspace @tutor/web

FROM nginxinc/nginx-unprivileged:1.27.3-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
