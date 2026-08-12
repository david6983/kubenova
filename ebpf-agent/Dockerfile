FROM golang:1.25-bookworm AS builder

# TARGETARCH is set automatically by docker buildx (amd64 / arm64)
ARG TARGETARCH=amd64

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -o /ebpf-agent .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /ebpf-agent /ebpf-agent
ENTRYPOINT ["/ebpf-agent"]
