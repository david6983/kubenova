### Stage 1 — build ###
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build

### Stage 2 — serve ###
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# Run as the built-in nginx user (uid 101) — no root needed for port 8080
RUN sed -i 's/listen\s*80;/listen 8080;/' /etc/nginx/conf.d/default.conf 2>/dev/null || true && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf.template

ENV SERVER_HOST=kubenova-server
ENV SERVER_PORT=3001

USER nginx
EXPOSE 8080

CMD ["/bin/sh", "-c", \
  "envsubst '${SERVER_HOST} ${SERVER_PORT}' \
     < /etc/nginx/nginx.conf.template \
     > /tmp/nginx.conf && exec nginx -c /tmp/nginx.conf -g 'daemon off;'"]
