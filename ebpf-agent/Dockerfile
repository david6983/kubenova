### Stage 1 — build ###
FROM golang:1.25-bookworm@sha256:6359592445455f2dbe2412bed411336035bc019a50017720d77454ffdd6d0f82 AS builder

ARG TARGETARCH=amd64

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /ebpf-agent .

### Stage 2 — minimal runtime ###
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    useradd -r -u 65532 -g root kubenova

COPY --from=builder --chown=65532:0 /ebpf-agent /ebpf-agent

# eBPF requires privileged — set in the DaemonSet securityContext, not here.
# The binary is owned by the non-root user but the pod runs privileged.
USER 65532

ENTRYPOINT ["/ebpf-agent"]
