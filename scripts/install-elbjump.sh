#!/usr/bin/env bash
# install-elbjump.sh — install the `elbjump` command for a teammate.
#
#   curl -fsSL https://raw.githubusercontent.com/OctopusRage/aws-topology-monitor/master/scripts/install-elbjump.sh | bash
#
# Prompts for the API key (never echoed), your Teleport login, and the SSH
# user, then writes ~/.config/elbjump/.env and puts `elbjump` in ~/.local/bin.
# Non-interactive: set ELBJUMP_API_KEY (and optionally ELBJUMP_URL,
# ELBJUMP_BASTION, ELBJUMP_SSH_USER) in the environment.

set -euo pipefail

RAW="${ELBJUMP_RAW:-https://raw.githubusercontent.com/OctopusRage/aws-topology-monitor/master/scripts/elbjump}"
DEFAULT_URL="https://hormuz.qiscus.io/_stellar"
DEFAULT_BASTION_HOST="awsjumpid.qiscus.io"
BIN_DIR="${ELBJUMP_BIN_DIR:-$HOME/.local/bin}"
CONF_DIR="$HOME/.config/elbjump"
CONF="$CONF_DIR/.env"

red()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
die()  { red "$*"; exit 1; }

# When piped through `curl | bash`, stdin is the script — talk to the terminal.
TTY=/dev/tty
( : < "$TTY" ) 2>/dev/null || TTY=""
ask() {           # ask VAR "prompt" "default" [silent]
  local var="$1" prompt="$2" def="${3:-}" silent="${4:-}" val=""
  if [[ -n "$TTY" ]]; then
    if [[ -n "$silent" ]]; then
      read -rsp "$prompt: " val < "$TTY" 2> "$TTY"; echo > "$TTY"
    else
      read -rp "$prompt${def:+ [$def]}: " val < "$TTY" 2> "$TTY"
    fi
  fi
  printf -v "$var" '%s' "${val:-$def}"
}

cyan "elbjump installer"

# ---- dependencies ------------------------------------------------------------
missing=()
for t in curl jq; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
[[ ${#missing[@]} -eq 0 ]] || die "missing required tools: ${missing[*]} — install them and re-run"
command -v fzf >/dev/null 2>&1 || echo "  note: fzf not found — elbjump will use a numbered menu (install fzf for fuzzy pickers)"

# tsh (Teleport CLI) is required: every ssh goes through the Teleport bastion.
if command -v tsh >/dev/null 2>&1; then
  tsh_ver="$(tsh version 2>/dev/null | sed -n 's/^Teleport v\{0,1\}\([^ ]*\).*/\1/p' | head -1)"
  grn "  ✓ tsh found: $(command -v tsh)${tsh_ver:+ (Teleport $tsh_ver)}"
  if tsh status >/dev/null 2>&1; then
    grn "  ✓ tsh is logged in as $(tsh status 2>/dev/null | sed -n 's/^ *Logged in as: *//p' | head -1)"
  else
    echo "  note: tsh is not logged in — elbjump will run 'tsh login --proxy=teleport.qiscus.io' on first use"
  fi
else
  red "  ✗ tsh (Teleport CLI) is not installed — it is required to reach instances through the bastion."
  red "    Install it, then re-run this installer:"
  red "      macOS:  brew install teleport"
  red "      Linux:  curl https://cdn.teleport.dev/install.sh | bash   (or see https://goteleport.com/docs/installation/)"
  exit 1
fi

# ---- settings ----------------------------------------------------------------
URL="${ELBJUMP_URL:-$DEFAULT_URL}"

API_KEY="${ELBJUMP_API_KEY:-}"
while [[ -z "$API_KEY" ]]; do
  [[ -n "$TTY" ]] || die "no terminal — set ELBJUMP_API_KEY in the environment"
  ask API_KEY "API key for $URL (ask the aws-topology-monitor admin)" "" silent
  [[ -n "$API_KEY" ]] || red "  the API key is required"
done

# Verify the key before writing anything.
code="$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $API_KEY" "$URL/api/elbs" || echo 000)"
case "$code" in
  200) grn "  ✓ API key accepted by $URL" ;;
  401) die "API key rejected by $URL (HTTP 401) — check the key and try again" ;;
  000) die "could not reach $URL — are you on the VPN / office network?" ;;
  *)   die "unexpected HTTP $code from $URL/api/elbs" ;;
esac

if [[ -n "${ELBJUMP_BASTION+x}" ]]; then
  BASTION="$ELBJUMP_BASTION"
else
  tsh_user="$(tsh status 2>/dev/null | sed -n 's/^ *Logged in as: *//p' | head -1 || true)"
  ask TELEPORT_USER "Teleport username" "${tsh_user:-$USER}"
  ask BASTION_HOST "Bastion host" "$DEFAULT_BASTION_HOST"
  BASTION="$TELEPORT_USER@$BASTION_HOST"
fi
SSH_USER="${ELBJUMP_SSH_USER:-}"
[[ -n "$SSH_USER" ]] || ask SSH_USER "SSH user on the instances" "ubuntu"

# ---- install -----------------------------------------------------------------
mkdir -p "$BIN_DIR" "$CONF_DIR"
tmp="$(mktemp)"
curl -fsSL "$RAW" -o "$tmp" || die "download failed: $RAW"
head -1 "$tmp" | grep -q '^#!' || die "downloaded file doesn't look like a script"
install -m 755 "$tmp" "$BIN_DIR/elbjump"; rm -f "$tmp"

[[ -f "$CONF" ]] && cp "$CONF" "$CONF.bak" && echo "  (previous config saved as $CONF.bak)"
umask 077
cat > "$CONF" <<CONF_EOF
URL=$URL
API_KEY=$API_KEY
SSH_USER=$SSH_USER
BASTION=$BASTION
CONF_EOF
chmod 600 "$CONF"

grn "✓ installed $BIN_DIR/elbjump"
grn "✓ config written to $CONF"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo; red "  $BIN_DIR is not in your PATH — add this to your shell rc:"
     echo "    export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
echo
cyan "Try it:"
echo "  elbjump            # ELB → target group → instance → ssh"
echo "  elbjump list       # print the load balancers"
