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
# distroless/static: the binary is CGO_ENABLED=0 (fully static), so it needs
# no libc, no shell, no package manager — just CA certs for the k8s API
# client, which this image already bundles. Cuts out debian's perl-base,
# libc6, gzip, etc. entirely instead of just not using them.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:1b7b9f0f0e0a1d2155f531db587cc48ec26aaf97ab64364225f5bf18a054e66a

COPY --from=builder --chown=65532:0 /ebpf-agent /ebpf-agent

# eBPF requires privileged — set in the DaemonSet securityContext, not here.
# The binary is owned by the non-root user but the pod runs privileged.
USER 65532

ENTRYPOINT ["/ebpf-agent"]
