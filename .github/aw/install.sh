#!/usr/bin/env sh
# Install the pinned gh-aw binary for the current platform.
#
# Single source of truth for the bootstrap: CI (.github/workflows/copilot-setup-steps.yml),
# AGENTS.md, and README.md all call this script, so the procedure exists in exactly one place.
#
# Why a direct release download instead of `gh extension install` / `go install`:
# both are blocked in restricted-network agent sandboxes, while the release CDN
# (release-assets.githubusercontent.com) is reachable. The binary is standalone — it is
# invoked as `gh-aw`, not as the `gh aw` extension (see .github/mcp.json).
#
# Usage:
#   sh .github/aw/install.sh            # installs to $HOME/.local/bin
#   GH_AW_INSTALL_DIR=/usr/local/bin sh .github/aw/install.sh
#
# Upgrade: edit .github/aw/version (one line), re-run this script, then recompile lock files
# with `gh-aw compile`.
set -eu

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# `tr -d` strips a trailing CR: a Windows checkout with core.autocrlf=true can store the pin
# with CRLF endings, and the carriage return would silently corrupt every URL built from it.
version="$(tr -d '\r\n' < "${script_dir}/version")"
install_dir="${GH_AW_INSTALL_DIR:-${HOME}/.local/bin}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  FreeBSD) os=freebsd ;;
  MINGW* | MSYS* | CYGWIN* | Windows_NT) os=windows ;;
  *)
    echo "gh-aw: unsupported operating system '$(uname -s)'." >&2
    echo "See https://github.com/github/gh-aw/releases/tag/${version} for available assets." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  i386 | i686) arch=386 ;;
  armv6l | armv7l) arch=arm ;;
  *)
    echo "gh-aw: unsupported architecture '$(uname -m)'." >&2
    echo "See https://github.com/github/gh-aw/releases/tag/${version} for available assets." >&2
    exit 1
    ;;
esac

asset="${os}-${arch}"
binary_name="gh-aw"
if [ "${os}" = "windows" ]; then
  asset="${asset}.exe"
  binary_name="gh-aw.exe"
fi

base_url="https://github.com/github/gh-aw/releases/download/${version}"
work_dir="$(mktemp -d)"
# shellcheck disable=SC2064 # expand work_dir now, while it is still set.
trap "rm -rf '${work_dir}'" EXIT

# Resolve the checksum manifest first: it is the authoritative list of published assets, so a
# platform the release does not build for fails here with an explanatory message (and the real
# asset list) instead of an opaque 404 from the asset download. `uname -s` and `uname -m` are
# mapped independently above, so they can name a combination that was never released.
curl -fsSL "${base_url}/checksums.txt" -o "${work_dir}/checksums.txt"
expected="$(awk -v asset="${asset}" '$2 == asset { print $1 }' "${work_dir}/checksums.txt")"
if [ -z "${expected}" ]; then
  echo "gh-aw: ${version} publishes no asset '${asset}' for $(uname -s)/$(uname -m)." >&2
  echo "gh-aw: available assets:" >&2
  awk '{ print "  " $2 }' "${work_dir}/checksums.txt" >&2
  exit 1
fi

echo "gh-aw: downloading ${version} asset '${asset}'..."
curl -fsSL "${base_url}/${asset}" -o "${work_dir}/${asset}"

# Verify the download against the published checksum before it becomes executable. FreeBSD ships
# neither sha256sum nor shasum in its base system, so `sha256 -q` is the third supported utility.
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${work_dir}/${asset}" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${work_dir}/${asset}" | awk '{ print $1 }')"
elif command -v sha256 >/dev/null 2>&1; then
  actual="$(sha256 -q "${work_dir}/${asset}")"
else
  echo "gh-aw: no SHA-256 utility found (need sha256sum, shasum, or sha256)." >&2
  echo "gh-aw: refusing to install an unverified binary." >&2
  exit 1
fi
if [ "${expected}" != "${actual}" ]; then
  echo "gh-aw: checksum mismatch for '${asset}' (expected ${expected}, got ${actual})." >&2
  exit 1
fi

mkdir -p "${install_dir}"
chmod +x "${work_dir}/${asset}"
mv "${work_dir}/${asset}" "${install_dir}/${binary_name}"

echo "gh-aw: installed ${version} to ${install_dir}/${binary_name}"
# Compare the resolved `gh-aw` with the one just installed: an older binary earlier in PATH would
# otherwise shadow it silently.
resolved="$(command -v gh-aw 2>/dev/null || true)"
if [ "${resolved}" != "${install_dir}/${binary_name}" ]; then
  echo "gh-aw: put ${install_dir} first on your PATH, e.g. export PATH=\"${install_dir}:\$PATH\"" >&2
fi
