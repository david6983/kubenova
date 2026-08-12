### Stage 1 — build the React app ###
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline
COPY . .
RUN npm run build

### Stage 2 — serve with nginx ###
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf.template

# Defaults — override via env or k8s Deployment
ENV SERVER_HOST=kubeboat-server
ENV SERVER_PORT=3001

EXPOSE 80

# envsubst at runtime so SERVER_HOST/SERVER_PORT can be injected without rebuild
CMD ["/bin/sh", "-c", \
  "envsubst '${SERVER_HOST} ${SERVER_PORT}' \
     < /etc/nginx/nginx.conf.template \
     > /etc/nginx/nginx.conf && exec nginx -g 'daemon off;'"]
