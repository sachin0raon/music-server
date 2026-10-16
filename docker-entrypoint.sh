#!/bin/sh
# The container starts as root only to normalise the data volume: when ./data does not
# exist yet, Docker creates the bind mount owned by root, which the unprivileged app user
# could not write to. Ownership is fixed once (a stat guards the common case), then the
# process drops to the app user. Started as a non-root user already, it just runs the command.
set -e

if [ "$(id -u)" = "0" ]; then
  data="${DATA_DIR:-/data}"
  if [ -d "$data" ] && [ "$(stat -c %u "$data")" != "1000" ]; then
    chown -R app:app "$data"
  fi
  exec setpriv --reuid=app --regid=app --init-groups "$@"
fi

exec "$@"
