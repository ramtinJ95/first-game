#!/usr/bin/env bash
# Installs Chromium for Playwright and, unless the runner image already has every one, the
# system packages it needs, reusing the .deb files an earlier run cached. Prints what it took.
set -euo pipefail
debs="$HOME/.cache/chromium-debs"
start=$(date +%s)
npx playwright install chromium
browser=$(($(date +%s) - start))
# The dry run asks apt locally, without the network, and fails while any package is missing.
if npx playwright install-deps --dry-run chromium; then
  how='all already installed'
else
  mkdir -p "$debs"
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' |
    sudo tee /etc/apt/apt.conf.d/99keep-downloaded-packages >/dev/null
  cached=$(find "$debs" -name '*.deb' | wc -l)
  if [ "$cached" -gt 0 ]; then sudo cp "$debs"/*.deb /var/cache/apt/archives/; fi
  npx playwright install-deps chromium
  find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -exec cp -t "$debs" {} +
  how="installed, with ${cached} packages from the cache"
fi
total=$(($(date +%s) - start))
echo "::notice title=Chromium install::${total} s in all: the browser ${browser} s, its system packages $((total - browser)) s, ${how}"
