#!/usr/bin/env bash
set -euo pipefail

# 4 workers: api, orders-payments, data-messaging, search-ml-infra
DOMAINS=(api orders-payments data-messaging search-ml-infra)
WORKERS=(
  shopnova-prod-worker
  shopnova-prod-worker2
  shopnova-prod-worker3
  shopnova-prod-worker4
)

for i in "${!WORKERS[@]}"; do
  node="${WORKERS[$i]}"
  domain="${DOMAINS[$i]}"
  echo "Labeling $node → domain=$domain"
  kubectl label node "$node" domain="$domain" --overwrite
done

echo "Done. Node labels:"
kubectl get nodes -L domain
