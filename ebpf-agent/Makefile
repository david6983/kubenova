IMAGE    := ebpf-agent:latest
CLUSTER  := dev
CONTEXT  := kind-$(CLUSTER)
NAMESPACE := kube-system

# Detect host arch and map to Go/Docker naming
HOST_ARCH := $(shell uname -m)
ifeq ($(HOST_ARCH),arm64)
  TARGETARCH := arm64
else ifeq ($(HOST_ARCH),aarch64)
  TARGETARCH := arm64
else
  TARGETARCH := amd64
endif
PLATFORM := linux/$(TARGETARCH)

.PHONY: generate build load deploy undeploy logs

# Run bpf2go inside Docker (needs clang + Linux) to generate flowtracker_bpf*.go
# Run this once, commit the generated files, then normal `go build` works.
generate:
	docker run --rm \
	  -v $(PWD):/src -w /src \
	  golang:1.25-bookworm \
	  bash -c "apt-get update -qq && apt-get install -y -qq clang llvm libbpf-dev linux-libc-dev && \
	    ARCH=\$$(uname -m) && \
	    [ \"\$$ARCH\" = aarch64 ] && MULTIARCH=aarch64-linux-gnu || MULTIARCH=x86_64-linux-gnu && \
	    ln -sfn /usr/include/\$$MULTIARCH/asm /usr/include/asm && \
	    go install github.com/cilium/ebpf/cmd/bpf2go@latest && \
	    go generate ./..."

build:
	docker build --platform $(PLATFORM) --build-arg TARGETARCH=$(TARGETARCH) -t $(IMAGE) .

load: build
	kind load docker-image $(IMAGE) --name $(CLUSTER)

deploy: load
	kubectl --context=$(CONTEXT) apply -f deploy/daemonset.yaml
	kubectl --context=$(CONTEXT) rollout status daemonset/ebpf-agent -n $(NAMESPACE)

undeploy:
	kubectl --context=$(CONTEXT) delete -f deploy/daemonset.yaml --ignore-not-found

logs:
	kubectl --context=$(CONTEXT) logs -n $(NAMESPACE) -l app=ebpf-agent -f --prefix

# Port-forward one agent pod to localhost:7777 for local testing
port-forward:
	kubectl --context=$(CONTEXT) port-forward -n $(NAMESPACE) \
	  $$(kubectl --context=$(CONTEXT) get pod -n $(NAMESPACE) -l app=ebpf-agent -o name | head -1) \
	  7777:7777
