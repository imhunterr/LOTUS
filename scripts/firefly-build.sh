#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.tooling/firefly"
mkdir -p "$DEST/bin"
command -v gcc >/dev/null || { echo 'FireFly SQLite needs gcc and libc6-dev.' >&2; exit 1; }
if [ ! -x "$DEST/go/bin/go" ]; then
  curl -fL --retry 3 https://go.dev/dl/go1.27.2.linux-amd64.tar.gz -o "$DEST/go.tar.gz"
  echo 'ecbadb99091a3f46e31f5f934b068b1864eafa7995211b39eaddf76996045fe5  '"$DEST/go.tar.gz" | sha256sum -c -
  tar -xzf "$DEST/go.tar.gz" -C "$DEST"
fi
export PATH="$DEST/go/bin:$PATH"
export GOPATH="$DEST/go-cache" GOCACHE="$DEST/build-cache" GOTOOLCHAIN=local
# Pins resolved from the official release tags, whose commits have verified
# GitHub signatures. SHA-256 values are repository-maintained archive pins.
# Download immutable commits so moving a tag cannot change the build inputs.
sources=(
  'firefly:1.5.0:2078d8031a824cd82af5b78214e818768522d075:0be9ac3852f4ffdbbc19a9b8e33bcaa836a7df2353d6cd823f7b8bb655ac1d4a'
  'fabconnect:0.10.0:efab8a2b0ff11863bbd9c5eb8a566820f560546b:e1ec1391fe1a2051bb24605b3db21f6f4d914e30fea44f37e322181dcfdc23f0'
)
source_dir=''
cleanup() {
  if [ -n "$source_dir" ]; then
    case "$source_dir" in "$DEST"/verified-source.*) rm -rf -- "$source_dir";; *) exit 1;; esac
  fi
}
trap cleanup EXIT
for entry in "${sources[@]}"; do
  IFS=: read -r repo version revision checksum <<< "$entry"
  archive="$DEST/$repo-$revision.tar.gz"
  if [ ! -f "$archive" ]; then
    curl -fL --retry 3 "https://codeload.github.com/hyperledger-firefly/$repo/tar.gz/$revision" -o "$archive"
  fi
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
  # Always extract verified bytes into a fresh directory. Previously extracted
  # or modified source trees must never bypass verification on repeat builds.
  source_dir="$(mktemp -d "$DEST/verified-source.XXXXXXXX")"
  tar -xzf "$archive" --strip-components=1 -C "$source_dir"
  (cd "$source_dir" && CGO_ENABLED=1 go build -trimpath -o "$DEST/bin/$repo" -ldflags "-X main.buildVersion=v$version" .)
  cleanup
  source_dir=''
done
sha256sum "$DEST/bin/firefly" "$DEST/bin/fabconnect" > "$DEST/build-sha256.txt"
echo 'Pinned FireFly 1.5.0 and FabConnect 0.10.0 built.'
