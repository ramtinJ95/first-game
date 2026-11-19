#!/usr/bin/env bash
# Installs Chromium for Playwright and, unless the runner image already has every one, the
# system packages it needs: first from the .deb files an earlier run kept, without the network,
# then from the mirror, then from Ubuntu's own when the mirror cannot be reached. Prints what it took.
set -euo pipefail
debs="$HOME/.cache/chromium-debs"
log=$(mktemp)
doing='installing the browser'
# The job's log is not always at hand, so a failure puts what it was doing and its last lines in the annotation.
trap 'code=$?; echo "::error title=Chromium install failed::${doing} exited ${code}%0A$(tail -n 15 "$log" | sed ":a;N;\$!ba;s/\n/%0A/g")"; exit "$code"' ERR
start=$(date +%s)
npx playwright install chromium 2>&1 | tee -a "$log"
browser=$(($(date +%s) - start))
# The dry run asks apt locally, without the network, lists what is missing, and fails while any is.
doing='asking apt what is missing'
if npx playwright install-deps --dry-run chromium > "$log.missing" 2>&1; then
  how='all already installed'
else
  missing=$(sed -n 's/^  \([a-z0-9][a-z0-9.+-]*\)$/\1/p' "$log.missing" | tr '\n' ' ')
  mkdir -p "$debs"
  sudo tee /etc/apt/apt.conf.d/99chromium-install >/dev/null <<'APT'
Binary::apt::APT::Keep-Downloaded-Packages "true";
Acquire::Retries "3";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT
  cached=$(find "$debs" -name '*.deb' | wc -l)
  if [ "$cached" -gt 0 ]; then sudo cp "$debs"/*.deb /var/cache/apt/archives/; fi
  doing='installing the missing packages from the cache'
  if [ -n "$missing" ] &&
    sudo apt-get install -y --no-install-recommends --no-download $missing >> "$log" 2>&1; then
    how="installed from the ${cached} packages in the cache, without the network"
  else
    how="installed from the mirror, with ${cached} packages from the cache"
    doing='installing from the mirror'
    # A mirror that cannot be reached fails in minutes; the second try goes to Ubuntu's own.
    if ! timeout 3m npx playwright install-deps chromium 2>&1 | tee -a "$log"; then
      echo "::warning title=Chromium install::The first mirror failed; trying archive.ubuntu.com"
      sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true
      doing='installing from archive.ubuntu.com'
      npx playwright install-deps chromium 2>&1 | tee -a "$log"
      how="installed from archive.ubuntu.com, with ${cached} packages from the cache"
    fi
  fi
fi
total=$(($(date +%s) - start))
echo "::notice title=Chromium install::${total} s in all: the browser ${browser} s, its system packages $((total - browser)) s, ${how}"
