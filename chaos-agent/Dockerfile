### Stage 1 — install pnpm deps ###
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps

RUN corepack enable && corepack prepare pnpm@10.2.1 --activate

WORKDIR /app
COPY package.json ./
RUN pnpm install --prod

### Stage 2 — fetch + verify kubectl (keeps curl out of the runtime image) ###
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS kubectl

ARG TARGETARCH=amd64
ARG KUBECTL_VERSION=v1.30.0

RUN apk add --no-cache curl && \
    curl -fsSL -o /usr/local/bin/kubectl \
      "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" && \
    curl -fsSL -o /tmp/kubectl.sha256 \
      "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl.sha256" && \
    echo "$(cat /tmp/kubectl.sha256)  /usr/local/bin/kubectl" | sha256sum -c - && \
    chmod +x /usr/local/bin/kubectl

### Stage 3 — minimal non-root runtime ###
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

RUN addgroup -S chaos && adduser -S -G chaos -h /home/chaos chaos

COPY --from=kubectl /usr/local/bin/kubectl /usr/local/bin/kubectl

WORKDIR /app
COPY --from=deps --chown=chaos:chaos /app/node_modules ./node_modules
COPY --chown=chaos:chaos package.json server.js chaos.js ./

ENV KUBECONFIG=/home/chaos/.kube/config
ENV NODE_ENV=production

USER chaos
EXPOSE 9666

CMD ["node", "--disable-proto=delete", "server.js"]
