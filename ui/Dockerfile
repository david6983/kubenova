### Stage 1 — build ###
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

RUN corepack enable && corepack prepare pnpm@10.2.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY ui/package.json ./ui/package.json
COPY chaos-agent/package.json ./chaos-agent/package.json
RUN pnpm install --frozen-lockfile --filter ui...

COPY ui ./ui
WORKDIR /app/ui
RUN pnpm run build

### Stage 2 — serve ###
FROM nginx:1.29-alpine-slim@sha256:c9366b8c560169b101ca0e5422ed063b20779e6454c2326b9c9704225c9b0c08

# Pull latest Alpine security patches for the packages nginx:alpine ships with
RUN apk update && apk upgrade --no-cache

# Run as the built-in nginx user (uid 101) — no root needed for port 8080
RUN sed -i 's/listen\s*80;/listen 8080;/' /etc/nginx/conf.d/default.conf 2>/dev/null || true && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

COPY --from=builder --chown=nginx:nginx /app/ui/dist /usr/share/nginx/html
COPY --chown=nginx:nginx ui/nginx.conf /etc/nginx/nginx.conf.template

ENV SERVER_HOST=kubenova-server
ENV SERVER_PORT=3001

USER nginx
EXPOSE 8080

CMD ["/bin/sh", "-c", \
  "envsubst '${SERVER_HOST} ${SERVER_PORT}' \
     < /etc/nginx/nginx.conf.template \
     > /tmp/nginx.conf && exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]
