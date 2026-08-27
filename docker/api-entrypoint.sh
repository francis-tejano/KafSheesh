#!/bin/sh
set -e
data_dir="${KAFSHEESH_DATA_DIR:-/data}"
mkdir -p "$data_dir"
chown -R node:node "$data_dir"
exec gosu node "$@"
