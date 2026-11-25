#!/bin/sh
# Git credential helper for Jeff terminals. It exchanges the short-lived token
# in JEFF_GIT_TOKEN for the connected user's provider credential. The provider
# token is never written to the shell environment or the repository.
[ "${1:-get}" = "get" ] || exit 0
[ -n "$JEFF_GIT_TOKEN" ] || exit 0
[ -n "$JEFF_GIT_CREDENTIAL_URL" ] || exit 0

host=""
while IFS= read -r line; do
  [ -z "$line" ] && break
  case "$line" in
    host=*) host=${line#host=} ;;
  esac
done

[ -n "$host" ] || exit 0

response=$(curl -fsS -G \
  -H "x-jeff-git-token: $JEFF_GIT_TOKEN" \
  --data-urlencode "host=$host" \
  "$JEFF_GIT_CREDENTIAL_URL" 2>/dev/null) || exit 0

printf '%s' "$response" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    if data.get("username") and data.get("password"):
        print("username=" + data["username"])
        print("password=" + data["password"])
except Exception:
    pass
'
