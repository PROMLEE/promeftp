#!/bin/bash
set -euo pipefail
umask 077
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/certificate.cnf" <<'CFG'
[req]
distinguished_name = dn
x509_extensions = extensions
prompt = no
[dn]
CN = PromeFTP Release Signing
O = Promlee
[extensions]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
CFG
/usr/bin/openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
  -config "$scratch/certificate.cnf" -keyout "$scratch/identity.key" \
  -out "$scratch/certificate.pem" >/dev/null 2>&1
python3 - "$scratch" <<'PY'
import sys,secrets
from pathlib import Path
(Path(sys.argv[1])/'password').write_text(secrets.token_urlsafe(48)+'\n')
PY
/usr/bin/openssl pkcs12 -export -inkey "$scratch/identity.key" -in "$scratch/certificate.pem" \
  -name 'PromeFTP Release Signing' -out "$scratch/identity.p12" -passout "file:$scratch/password"
swift "$source_dir/scripts/GenerateReleaseKey.swift" "$scratch/sparkle.key" > "$scratch/public-key.txt"
python3 - "$scratch" <<'PY'
import base64,json,sys
from pathlib import Path
p=Path(sys.argv[1])
value={'MACOS_SIGNING_P12':base64.b64encode((p/'identity.p12').read_bytes()).decode(),
       'MACOS_SIGNING_PASSWORD':(p/'password').read_text().strip(),
       'SPARKLE_ED_PRIVATE_KEY':(p/'sparkle.key').read_text().strip()}
(p/'keychain.json').write_text(json.dumps(value))
PY
swift "$source_dir/scripts/StoreReleaseIdentity.swift" "$scratch/keychain.json"
cp "$scratch/certificate.pem" "$source_dir/updates/code-signing-certificate.pem"
cp "$scratch/public-key.txt" "$source_dir/updates/public-key.txt"
/usr/bin/openssl x509 -in "$scratch/certificate.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':' > "$source_dir/updates/code-signing-sha1.txt"
echo "Stored PromeFTP release identity in the default macOS keychain."
