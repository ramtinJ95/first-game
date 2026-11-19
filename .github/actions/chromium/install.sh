#!/usr/bin/env bash
# Installs Chromium for Playwright and, unless the runner image already has every one, the
# system packages it needs, from the .deb files an earlier run kept, fetching only the rest,
# from a second mirror when the first cannot be reached. Prints what it took.
set -euo pipefail
debs="$HOME/.cache/chromium-debs"
log=$(mktemp)
# The job's log is not always at hand, so a failure puts its command and last lines in the annotation.
trap 'code=$?; echo "::error title=Chromium install failed::${BASH_COMMAND} exited ${code}%0A$(tail -n 15 "$log" | sed ":a;N;\$!ba;s/\n/%0A/g")"; exit "$code"' ERR
start=$(date +%s)
npx playwright install chromium 2>&1 | tee -a "$log"
browser=$(($(date +%s) - start))
# The dry run asks apt locally, without the network, and fails while any package is missing.
if npx playwright install-deps --dry-run chromium; then
  how='all already installed'
else
  sudo tee /etc/apt/apt.conf.d/99chromium-install >/dev/null <<'APT'
Binary::apt::APT::Keep-Downloaded-Packages "true";
Acquire::Retries "3";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT
  cached=$(find "$debs" -name '*.deb' 2>/dev/null | wc -l)
  if [ "$cached" -gt 0 ]; then sudo cp "$debs"/*.deb /var/cache/apt/archives/; fi
  how="installed, with ${cached} packages from the cache"
  # A mirror that cannot be reached fails in minutes; the second try goes to Ubuntu's own.
  if ! timeout 4m npx playwright install-deps chromium 2>&1 | tee -a "$log"; then
    echo "::warning title=Chromium install::The first mirror failed; trying archive.ubuntu.com"
    sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' \
      /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true
    npx playwright install-deps chromium 2>&1 | tee -a "$log"
    how="${how}, after a second try on archive.ubuntu.com"
  fi
fi
total=$(($(date +%s) - start))
echo "::notice title=Chromium install::${total} s in all: the browser ${browser} s, its system packages $((total - browser)) s, ${how}"
