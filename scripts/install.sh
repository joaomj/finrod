#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: bash scripts/install.sh' \
    'Install Finrod for the current Linux user from this checkout.' \
    'Existing configuration and data are preserved. Credentials are prompted privately.'
}
if [[ ${1-} == --help ]]; then usage; exit 0; fi
if (( $# )); then usage >&2; exit 2; fi
if [[ $(uname -s) != Linux || $EUID == 0 ]]; then
  printf '%s\n' 'Run this installer as a non-root Linux user.' >&2
  exit 1
fi

project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
config_dir="$HOME/.config/finrod"
environment="$config_dir/environment"
unit_dir="$HOME/.config/systemd/user"
unit_file="$unit_dir/finrod.service"
runtime_dir="$HOME/.local/share/finrod-runtime"
work_dir=''
config_candidate=''
unit_candidate=''
service_stopped=false

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
safe_path() {
  [[ $1 =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail "Use an absolute path without spaces or special characters: $2."
}
cleanup() {
  local status=$?
  if (( status != 0 )) && $service_stopped; then
    printf '%s\n' 'Finrod was stopped for installation. Resolve the error and rerun before starting it.' >&2
  fi
  [[ -z $unit_candidate ]] || rm -f -- "$unit_candidate"
  [[ -z $config_candidate ]] || rm -f -- "$config_candidate"
  [[ -z $work_dir ]] || rm -rf -- "$work_dir"
}
on_error() {
  local status=$1 line=$2
  printf 'Installation failed near line %s (exit %s). Log: %s\n' "$line" "$status" "$log_file" >&2
  exit "$status"
}
confirm() {
  local reply
  read -r -p "$1 [y/N] " reply </dev/tty || return 1
  [[ $reply == y || $reply == Y || $reply == yes ]]
}

safe_path "$project" 'checkout'
safe_path "$HOME" 'HOME'
log_file=$(mktemp /tmp/finrod-install.XXXXXX.log)
exec > >(tee -a "$log_file") 2>&1
trap cleanup EXIT
trap 'on_error "$?" "$LINENO"' ERR
printf 'Finrod installer. Log: %s\n' "$log_file"

missing=()
for command in curl tar xz sha256sum flock systemctl systemd-analyze; do
  if ! command -v "$command" >/dev/null 2>&1; then missing+=("$command"); fi
done
if (( ${#missing[@]} )); then
  printf 'Missing operating-system prerequisites: %s\n' "${missing[*]}"
  command -v apt-get >/dev/null 2>&1 || fail 'Install curl, tar, xz, coreutils, util-linux, and systemd with your distribution package manager, then rerun.'
  command -v sudo >/dev/null 2>&1 || fail 'An administrator must install the missing operating-system prerequisites before you rerun.'
  confirm 'Install prerequisites using sudo and apt-get?' || fail 'Prerequisite installation cancelled.'
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates tar xz-utils coreutils util-linux systemd
fi

mkdir -p -- "$config_dir"
exec 9>"$config_dir/install.lock"
flock -n 9 || fail 'Another Finrod installation is running for this user.'
work_dir=$(mktemp -d /tmp/finrod-install.XXXXXX)
cd -- "$project"
[[ -f package-lock.json && -f deploy/finrod.service.in ]] || fail 'Run from a complete Finrod checkout.'
systemctl --user show-environment >/dev/null || fail 'The systemd user manager is unavailable. Run from a login session with user services enabled.'

compatible_node() {
  "$1" -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number); process.exit(major===22 && (minor>22 || (minor===22 && patch>=1)) ? 0 : 1)' >/dev/null 2>&1
}
node_path=$(command -v node || true)
if [[ -n $node_path ]] && compatible_node "$node_path" && command -v npm >/dev/null 2>&1; then
  node_path=$(readlink -f -- "$node_path")
elif [[ -x $runtime_dir/node/bin/node ]] && compatible_node "$runtime_dir/node/bin/node"; then
  node_path="$runtime_dir/node/bin/node"
else
  [[ ! -e $runtime_dir/node ]] || fail 'The managed Node installation is incompatible. Move ~/.local/share/finrod-runtime/node aside and rerun.'
  case $(uname -m) in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail 'Automatic Node installation supports Linux x86_64 and arm64 only.' ;;
  esac
  printf '%s\n' 'Installing the current Node 22 release under ~/.local/share/finrod-runtime.'
  base=https://nodejs.org/dist/latest-v22.x
  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 180 --retry 2 --retry-max-time 300 --proto '=https' --proto-redir '=https' \
    "$base/SHASUMS256.txt" -o "$work_dir/SHASUMS256.txt"
  manifest=$(awk -v arch="$arch" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") { print $1, $2 }' "$work_dir/SHASUMS256.txt")
  [[ -n $manifest && $manifest != *$'\n'* ]] || fail 'Node release manifest did not contain exactly one matching archive.'
  read -r checksum archive <<< "$manifest"
  [[ $checksum =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid Node archive checksum in release manifest.'
  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 180 --retry 2 --retry-max-time 300 --proto '=https' --proto-redir '=https' \
    "$base/$archive" -o "$work_dir/$archive"
  (cd -- "$work_dir" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status)
  tar -xJf "$work_dir/$archive" -C "$work_dir"
  compatible_node "$work_dir/${archive%.tar.xz}/bin/node" || fail 'Downloaded Node cannot run here. Use a supported glibc Linux host.'
  mkdir -p -- "$runtime_dir"
  mv -- "$work_dir/${archive%.tar.xz}" "$runtime_dir/node"
  node_path="$runtime_dir/node/bin/node"
fi
safe_path "$node_path" 'Node executable'
node_bin=$(dirname -- "$node_path")
PATH="$node_bin:$PATH"
export PATH
printf 'Using Node %s.\n' "$("$node_path" --version)"

if [[ -L $environment ]]; then fail 'The environment file is a symlink; use a regular private file.'; fi
if [[ -e $environment ]]; then
  [[ -f $environment && -O $environment ]] || fail 'The environment file must be a regular file owned by this user.'
  chmod 600 -- "$environment"
  printf '%s\n' 'Keeping the existing environment file; no credentials or settings will be replaced.'
else
  [[ -t 0 ]] || fail 'First installation requires an interactive terminal to collect credentials.'
  declare -A settings=()
  prompt() {
    local key=$1 label=$2 secret=${3:-no} required=${4:-yes} value
    while true; do
      if [[ $secret == yes ]]; then
        read -r -s -p "$label: " value </dev/tty
        printf '\n'
      else
        read -r -p "$label: " value </dev/tty
      fi
      if [[ -z $value && $required == yes ]]; then printf '%s is required.\n' "$key"; continue; fi
      if [[ $value == *"'"* || $value == *$'\r'* ]]; then
        printf '%s cannot contain single quotes or carriage returns in the shared environment format.\n' "$key"
        continue
      fi
      [[ -z $value ]] || settings[$key]=$value
      break
    done
  }
  prompt TELEGRAM_BOT_TOKEN 'Telegram bot token' yes
  prompt TELEGRAM_USER_ID 'Your numeric Telegram user ID'
  while true; do
    prompt FINROD_MODEL_PROVIDER 'Chat provider (openrouter, anthropic, openai)'
    case ${settings[FINROD_MODEL_PROVIDER]} in
      openrouter) chat_key=OPENROUTER_API_KEY; break ;;
      anthropic) chat_key=ANTHROPIC_API_KEY; break ;;
      openai) chat_key=OPENAI_API_KEY; break ;;
      *) printf '%s\n' 'Choose one of the listed providers.' ;;
    esac
  done
  prompt FINROD_MODEL 'Chat model ID from the chosen provider in the installed Pi catalog'
  prompt "$chat_key" "$chat_key" yes
  while true; do
    prompt TRANSCRIPTION_PROVIDER 'Transcription provider (openrouter or openai-compatible)'
    case ${settings[TRANSCRIPTION_PROVIDER]} in openrouter|openai-compatible) break ;; esac
    printf '%s\n' 'Choose one of the listed transcription providers.'
  done
  if [[ ${settings[TRANSCRIPTION_PROVIDER]} == openrouter ]]; then
    if [[ -z ${settings[OPENROUTER_API_KEY]-} ]]; then prompt OPENROUTER_API_KEY 'OpenRouter transcription API key' yes; fi
  else
    printf '%s\n' 'The OpenAI-compatible transcription server must already be running; Finrod does not install it.'
    prompt TRANSCRIPTION_BASE_URL 'Transcription base URL (Enter for the application default)' no no
    prompt TRANSCRIPTION_API_KEY 'Transcription API key (Enter if none)' yes no
  fi
  prompt TRANSCRIPTION_MODEL 'Transcription model ID (Enter for the application default)' no no
  prompt TRANSCRIPTION_LANGUAGE 'Transcription language code (Enter for the application default)' no no
  prompt EXA_API_KEY 'Exa API key (Enter for keyless search)' yes no
  config_candidate=$(mktemp "$config_dir/.environment.XXXXXX")
  for key in "${!settings[@]}"; do printf "%s='%s'\n" "$key" "${settings[$key]}" >> "$config_candidate"; done
  unset settings
  printf '%s\n' 'Credentials collected privately; configuration will be installed after validation.'
fi

active=$(systemctl --user show finrod.service --property=ActiveState --value)
if [[ $active != inactive && $active != failed ]]; then
  confirm 'Finrod is running. Stop it while dependencies and code are updated?' || fail 'Installation cancelled; the running service was not stopped.'
  systemctl --user stop finrod.service
  service_stopped=true
fi
printf '%s\n' 'Installing locked dependencies and building Finrod.'
npm ci --ignore-scripts --include=dev --no-audit --no-fund
npm run build
validation_file=${config_candidate:-$environment}
data_dir=$("$node_path" scripts/validate-install.mjs "$validation_file")
safe_path "$data_dir" 'FINROD_DATA_DIR'
[[ $data_dir != / && $data_dir != "$HOME" && $data_dir != "$project" && $data_dir != "$project/"* ]] || fail 'FINROD_DATA_DIR must be a dedicated directory outside the checkout.'
mkdir -p -- "$data_dir" "$unit_dir"
if [[ -n $config_candidate ]]; then
  ln -- "$config_candidate" "$environment"
  rm -- "$config_candidate"
  config_candidate=''
fi
sed -e "s|@PROJECT@|$project|g" -e "s|@NODE@|$node_path|g" -e "s|@DATA@|$data_dir|g" \
  deploy/finrod.service.in > "$work_dir/finrod.service"
systemd-analyze --user verify "$work_dir/finrod.service"
if [[ -L $unit_file ]]; then fail 'The existing service unit is a symlink; inspect it before replacing it.'; fi
if [[ -e $unit_file ]] && ! cmp -s -- "$work_dir/finrod.service" "$unit_file"; then
  confirm 'The existing finrod.service differs. Back it up and replace it?' || fail 'Service replacement cancelled. The existing unit remains unchanged.'
  backup=$(mktemp "$unit_dir/finrod.service.backup.XXXXXX")
  cp -p -- "$unit_file" "$backup"
  printf 'Previous service unit saved to %s.\n' "$backup"
fi
unit_candidate=$(mktemp "$unit_dir/.finrod.service.XXXXXX")
install -m 600 -- "$work_dir/finrod.service" "$unit_candidate"
mv -f -- "$unit_candidate" "$unit_file"
unit_candidate=''
systemctl --user daemon-reload
systemctl --user enable finrod.service
systemctl --user restart finrod.service
service_stopped=false
systemctl --user is-active finrod.service
printf '\n%s\n' 'Finrod service started. This does not verify live integrations.' \
  'Send /start, a text message, and a short voice note in Telegram.' \
  'Inspect failures with: journalctl --user -u finrod.service -n 40 --no-pager' \
  'For boot without login on a VPS, enable user lingering as described in docs/OPERATIONS.md.'
printf 'Configuration: %s\nData: %s\nLog: %s\n' "$environment" "$data_dir" "$log_file"
