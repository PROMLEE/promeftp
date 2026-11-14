#!/bin/sh
# OpenSSH supplies the prompt as argv[1]. The response travels only on the socket.
set -eu
prompt=$(printf '%s' "${1-}" | /usr/bin/base64 | /usr/bin/tr -d '\n')
printf '%s\n%s\n%s\n' "$PPID" "${SSH_ASKPASS_PROMPT-}" "$prompt" | /usr/bin/nc -U "$PROMEFTP_ASKPASS_SOCKET"
