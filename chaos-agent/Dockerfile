FROM node:20-alpine

RUN apk add --no-cache curl bash

ARG KUBECTL_VERSION=v1.30.0
RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js chaos.js ./

EXPOSE 9666
CMD ["node", "server.js"]
