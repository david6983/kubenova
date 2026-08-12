#!/usr/bin/env bash
# Convert a screen recording to a GitHub-friendly MP4.
# Usage: ./scripts/convert-video.sh input.mov [output.mp4]

set -euo pipefail

INPUT="${1:?Usage: $0 input.mov [output.mp4]}"
OUTPUT="${2:-${INPUT%.*}.mp4}"

if ! command -v ffmpeg &>/dev/null; then
  echo "ffmpeg not found — install with: brew install ffmpeg" >&2
  exit 1
fi

ffmpeg -i "$INPUT" \
  -c:v libx264 -crf 22 -preset slow \
  -vf "scale='min(1920,iw)':-2" \
  -an \
  -movflags +faststart \
  "$OUTPUT" -y

SIZE=$(du -sh "$OUTPUT" | cut -f1)
echo "Done: $OUTPUT ($SIZE)"
