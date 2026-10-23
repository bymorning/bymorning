#!/bin/sh
# Installs the release-evidence toolchain (syft, grype, cosign, gitleaks) at
# pinned versions with sha256-verified downloads. Used by
# .github/workflows/full-gate.yml and ci.yml on ubuntu runners; also handy for
# maintainers on Linux x86_64 hosts. macOS users: brew install syft grype
# cosign gitleaks semgrep trivy osv-scanner.
set -eu

dest="${1:-/usr/local/bin}"
mkdir -p "$dest" 2>/dev/null || sudo mkdir -p "$dest"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

fetch() { # <url> <sha256> <file>
  curl -fsSLo "$3" "$1"
  echo "$2  $3" | sha256sum -c - >/dev/null
}

fetch https://github.com/anchore/syft/releases/download/v1.52.0/syft_1.52.0_linux_amd64.tar.gz \
  caeedb81fb0491615f1ebd1761e4145d41ee86dd2cc7bf80669f9f5ad9d6133d syft.tar.gz
tar -xzf syft.tar.gz syft

fetch https://github.com/anchore/grype/releases/download/v0.119.0/grype_0.119.0_linux_amd64.tar.gz \
  3fa2dc4b924621ab65404cf08d0b8438d896d80ab949c9d5a4ca283c36004c9b grype.tar.gz
tar -xzf grype.tar.gz grype

fetch https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64 \
  4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71 cosign

fetch https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb gitleaks.tar.gz
tar -xzf gitleaks.tar.gz gitleaks

chmod +x syft grype cosign gitleaks
for tool in syft grype cosign gitleaks; do
  if [ -w "$dest" ]; then mv "$tool" "$dest/"; else sudo mv "$tool" "$dest/"; fi
done
echo "installed: $(syft --version), $(grype version 2>/dev/null | sed -n 's/^Version: *//p' | head -1), cosign $(cosign version 2>/dev/null | sed -n 's/^  GitVersion: *//p'), gitleaks $(gitleaks version)"
