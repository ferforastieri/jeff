#!/bin/sh
# Aligns the container with the host user that owns the mounted workspace, then
# drops privileges. The workspace itself is a bind mount and is never chowned;
# only the named data volume and the home directory belong to the container.
set -eu

uid="${JEFF_UID:-1000}"
gid="${JEFF_GID:-${JEFF_WORKSPACE_GID:-1000}}"
workspace_gid="${JEFF_WORKSPACE_GID:-}"

is_id() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

if ! is_id "$uid"; then
  echo "JEFF_UID must be a numeric user id (got '$uid')" >&2
  exit 1
fi
if ! is_id "$gid"; then
  echo "JEFF_GID must be a numeric group id (got '$gid')" >&2
  exit 1
fi
if [ -n "$workspace_gid" ] && ! is_id "$workspace_gid"; then
  echo "JEFF_WORKSPACE_GID must be a numeric group id (got '$workspace_gid')" >&2
  exit 1
fi

if [ "$(id -u)" != "0" ]; then
  exec /usr/local/bin/jeff
fi

chown -R "$uid:$gid" /data /home/jeff 2>/dev/null || true

# Node, git and the harness resolve the current user through passwd. Create an
# entry for a host UID the image does not know yet.
if ! getent passwd "$uid" >/dev/null 2>&1; then
  if ! getent group "$gid" >/dev/null 2>&1; then
    groupadd --gid "$gid" jeff-runtime 2>/dev/null || true
  fi
  useradd --uid "$uid" --gid "$gid" --home-dir /home/jeff --shell /bin/bash --no-create-home jeff-runtime 2>/dev/null || true
fi

# Docker's group_add does not survive initgroups; carry the workspace group
# explicitly when it is not the runtime primary group.
if [ -n "$workspace_gid" ] && [ "$workspace_gid" != "$gid" ]; then
  exec setpriv --reuid="$uid" --regid="$gid" --groups="$workspace_gid" /usr/local/bin/jeff
fi

if getent passwd "$uid" >/dev/null 2>&1; then
  exec setpriv --reuid="$uid" --regid="$gid" --init-groups /usr/local/bin/jeff
fi
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups /usr/local/bin/jeff