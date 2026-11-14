#!/usr/bin/env python3
"""Run the release signer without exporting private credentials to a shell."""
import json
import os
from pathlib import Path
import subprocess
import sys

scripts = Path(__file__).resolve().parent
secret = json.loads(subprocess.check_output([
    'swift', scripts / 'StoreReleaseIdentity.swift', '--read',
], text=True))
fields = {'MACOS_SIGNING_P12', 'MACOS_SIGNING_PASSWORD', 'SPARKLE_ED_PRIVATE_KEY'}
if set(secret) != fields or not all(secret.values()):
    raise SystemExit('Invalid PromeFTP release identity in Keychain')
signer = Path(__file__).resolve().with_name('sign-release.py')
subprocess.run([sys.executable, signer, *sys.argv[1:]], env=dict(os.environ, **secret), check=True)
