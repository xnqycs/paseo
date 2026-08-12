#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mapfile -t packages < <(find "$script_dir/packages" -maxdepth 1 -type f -name '*.tgz' | sort)

if [[ ${#packages[@]} -ne 6 ]]; then
  printf 'Expected 6 Paseo packages, found %s\n' "${#packages[@]}" >&2
  exit 1
fi

npm install --global --no-audit --no-fund "${packages[@]}"
paseo --version
