#!/usr/bin/env bash
# Cached, altered archives and old extracted trees must fail before extraction.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case_root="$(mktemp -d "${TMPDIR:-/tmp}/lotus-source-integrity.XXXXXXXX")"
cleanup() {
  case "$case_root" in "${TMPDIR:-/tmp}"/lotus-source-integrity.*) rm -rf -- "$case_root";; *) exit 1;; esac
}
trap cleanup EXIT
mkdir -p "$case_root/scripts" "$case_root/.tooling/firefly/go/bin" "$case_root/mock-bin"
cp "$ROOT/scripts/firefly-build.sh" "$case_root/scripts/firefly-build.sh"
printf '#!/usr/bin/env bash\ntouch "$LOTUS_TEST_MARKER"\nexit 0\n' > "$case_root/.tooling/firefly/go/bin/go"
cp "$case_root/.tooling/firefly/go/bin/go" "$case_root/mock-bin/tar"
printf '#!/usr/bin/env bash\nexit 0\n' > "$case_root/mock-bin/gcc"
chmod +x "$case_root/.tooling/firefly/go/bin/go" "$case_root/mock-bin/"*
revision="$(sed -n "s/.*'firefly:1\.5\.0:\([a-f0-9]*\):.*/\1/p" "$case_root/scripts/firefly-build.sh")"
test -n "$revision"
printf 'altered archive' > "$case_root/.tooling/firefly/firefly-$revision.tar.gz"
mkdir -p "$case_root/.tooling/firefly/firefly-1.5.0"
export LOTUS_TEST_MARKER="$case_root/extracted-or-built"
if PATH="$case_root/mock-bin:$PATH" bash "$case_root/scripts/firefly-build.sh" > "$case_root/result.log" 2>&1; then
  echo 'An altered cached archive was accepted.' >&2
  exit 1
fi
grep -q 'FAILED' "$case_root/result.log"
test ! -e "$LOTUS_TEST_MARKER"
echo 'Altered cached archive rejected before extraction/build, despite an existing source tree.'
