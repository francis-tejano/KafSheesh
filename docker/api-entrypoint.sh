#!/bin/sh
set -e

# Apply .env.example for any unset keys (docker run without Compose, or Compose without .env).
# KAFSHEESH_DATA_DIR stays container-local; the example file is for host/dev paths.
if [ -f /app/.env.example ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '' | \#*) continue ;;
    esac
    key="${line%%=*}"
    if [ "$key" = "KAFSHEESH_DATA_DIR" ]; then
      continue
    fi
    if eval "test \"\${$key+set}\" = set"; then
      continue
    fi
    export "$line"
  done < /app/.env.example
fi

data_dir="${KAFSHEESH_DATA_DIR:-/data}"
mkdir -p "$data_dir"
chown -R node:node "$data_dir"
exec gosu node "$@"
