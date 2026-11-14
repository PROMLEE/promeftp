#!/usr/bin/env python3
"""Sign a prepared PromeFTP bundle and its Sparkle feed using existing CI secrets."""
import base64
from datetime import datetime, timezone
from email.utils import format_datetime
import hashlib
from html import escape
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
REPO = 'PROMLEE/promeftp'
APP_ID = 'com.promlee.promeftp'
NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
ET.register_namespace('sparkle', NS)


def run(*args, quiet=False):
    result = subprocess.run(args, stdout=subprocess.DEVNULL if quiet else None,
                            stderr=subprocess.DEVNULL if quiet else None)
    if result.returncode:
        name = f'{args[0]} {args[1]}' if quiet else args[0]
        raise SystemExit(f'{name} failed ({result.returncode})')


def digest(file):
    with file.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    app, tool, output = (Path(arg).resolve() for arg in sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    with (app / 'Contents/Info.plist').open('rb') as file:
        info = plistlib.load(file)
    version = info['CFBundleShortVersionString']
    key = (ROOT / 'updates/public-key.txt').read_text().strip()
    pin = (ROOT / 'updates/code-signing-sha1.txt').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or info['CFBundleVersion'] != version:
        raise SystemExit('Invalid release version')
    if info['CFBundleIdentifier'] != APP_ID or info.get('SUPublicEDKey') != key:
        raise SystemExit('Invalid production app identity or update key')
    feed_root = f'https://raw.githubusercontent.com/{REPO}/main/updates/'
    if info.get('SUFeedURL') not in {feed_root + 'appcast-arm64.xml', feed_root + 'beta/appcast-arm64.xml'}:
        raise SystemExit('Invalid production update URL')
    if not all(info.get(k) is True for k in ('SUVerifyUpdateBeforeExtraction', 'SURequireSignedFeed')):
        raise SystemExit('Mandatory update verification is disabled')
    arch = subprocess.check_output(['lipo', '-archs', app / 'Contents/MacOS/Electron'], text=True).strip()
    if arch != 'arm64':
        raise SystemExit('Expected Apple Silicon bundle')

    encoded = os.environ.pop('MACOS_SIGNING_P12', '')
    password = os.environ.pop('MACOS_SIGNING_PASSWORD', '')
    sparkle = os.environ.pop('SPARKLE_ED_PRIVATE_KEY', '')
    if not all((encoded, password, sparkle)):
        raise SystemExit('Missing production signing secrets')
    os.umask(0o077)
    original = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
    with tempfile.TemporaryDirectory(prefix='promeftp-sign-') as directory:
        tmp = Path(directory)
        p12 = tmp / 'identity.p12'
        p12.write_bytes(base64.b64decode(''.join(encoded.split()), validate=True))
        key_file = tmp / 'sparkle.key'
        key_file.write_text(sparkle + '\n')
        chain = str(tmp / 'release.keychain-db')
        chain_password = secrets.token_urlsafe(36)
        try:
            run('security', 'create-keychain', '-p', chain_password, chain, quiet=True)
            run('security', 'set-keychain-settings', '-lut', '3600', chain, quiet=True)
            run('security', 'unlock-keychain', '-p', chain_password, chain, quiet=True)
            run('security', 'import', p12, '-k', chain, '-P', password, '-T', '/usr/bin/codesign', quiet=True)
            run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
                '-s', '-k', chain_password, chain, quiet=True)
            run('security', 'list-keychains', '-d', 'user', '-s', *original, chain, quiet=True)
            sign_bundle(app, tmp, chain, pin)
        finally:
            run('security', 'list-keychains', '-d', 'user', '-s', *original, quiet=True)
            subprocess.run(['security', 'delete-keychain', chain], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)

        prefix = output / f'PromeFTP-{version}-macos-arm64'
        archive = Path(str(prefix) + '.zip')
        dmg = Path(str(prefix) + '.dmg')
        run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, archive)
        stage = tmp / 'dmg'
        stage.mkdir()
        run('ditto', app, stage / app.name)
        (stage / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-quiet', '-srcfolder', stage, '-volname', 'PromeFTP', '-format', 'UDZO', dmg)
        run('hdiutil', 'verify', dmg)
        for file in (archive, dmg):
            Path(str(file) + '.sha256').write_text(f'{digest(file)}  {file.name}\n')
        make_feed(tool, key_file, version, archive, output / 'appcast-arm64.xml')
        make_agent_skill(tool, key_file, version, output)


def make_agent_skill(tool, key_file, version, output):
    skill = (ROOT / 'agent-skills/promeftp/SKILL.md').read_bytes()
    target = output / 'skills/promeftp'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'SKILL.md').write_bytes(skill)
    entry = {
        'protocol': 1, 'appVersion': version, 'release': version, 'version': version,
        'targets': ['codex', 'claude', 'cursor', 'gemini', 'copilot'],
        'sha256': hashlib.sha256(skill).hexdigest(),
        'url': f'https://raw.githubusercontent.com/{REPO}/v{version}/skills/promeftp/SKILL.md',
    }
    payload = json.dumps({'packages': [entry]}, separators=(',', ':')).encode()
    with tempfile.TemporaryDirectory(prefix='promeftp-skill-') as directory:
        source = Path(directory) / 'manifest.bin'
        source.write_bytes(payload)
        command = [str(tool), '--ed-key-file', str(key_file)]
        signature = subprocess.check_output([*command, '-p', source], text=True).strip()
        run('xcrun', 'swift', ROOT / 'scripts/VerifyUpdate.swift', ROOT / 'updates/public-key.txt', source, signature)
    (output / 'agent-skills.json').write_text(json.dumps({
        'manifest': base64.b64encode(payload).decode(), 'signature': signature,
    }) + '\n')


def sign_bundle(app, tmp, chain, pin):
    frameworks = app / 'Contents/Frameworks'
    pty = app / 'Contents/Resources/app/node_modules/node-pty/prebuilds/darwin-arm64'
    entitlements = tmp / 'runtime.plist'
    with entitlements.open('wb') as file:
        plistlib.dump({'com.apple.security.cs.allow-jit': True,
                       'com.apple.security.cs.disable-library-validation': True}, file)
    sign = ['codesign', '--force', '--sign', pin, '--keychain', chain, '--timestamp=none']
    for component in (pty / 'pty.node', pty / 'spawn-helper', frameworks / 'PromeFTPUpdate.node', app / 'Contents/MacOS/promeftp'):
        run(*sign, component)
    run(*sign, '--deep', app)
    for helper in sorted(frameworks.glob('Electron Helper*.app')):
        run(*sign, '--options', 'runtime', '--entitlements', entitlements, helper)
    run(*sign, '--options', 'runtime', '--entitlements', entitlements, app)
    run('codesign', '--verify', '--deep', '--strict', app)
    run('codesign', '--verify', f'-R=identifier "{APP_ID}" and certificate leaf = H"{pin}"', app)


def make_feed(tool, key_file, version, archive, output):
    command = [str(tool), '--ed-key-file', str(key_file)]
    signature = subprocess.check_output([*command, '-p', archive], text=True).strip()
    run(*command, '--verify', archive, signature)
    verifier = ROOT / 'scripts/VerifyUpdate.swift'
    run('xcrun', 'swift', verifier, ROOT / 'updates/public-key.txt', archive, signature)

    rss = ET.Element('rss', version='2.0')
    channel = ET.SubElement(rss, 'channel')
    ET.SubElement(channel, 'title').text = 'PromeFTP'
    item = ET.SubElement(channel, 'item')
    ET.SubElement(item, 'title').text = f'PromeFTP {version}'
    ET.SubElement(item, 'link').text = f'https://github.com/{REPO}/releases/tag/v{version}'
    ET.SubElement(item, 'pubDate').text = format_datetime(datetime.now(timezone.utc))
    ET.SubElement(item, f'{{{NS}}}version').text = version
    ET.SubElement(item, f'{{{NS}}}shortVersionString').text = version
    ET.SubElement(item, f'{{{NS}}}minimumSystemVersion').text = '13.0.0'
    add_release_notes(item, version)
    ET.SubElement(item, 'enclosure', {
        'url': f'https://github.com/{REPO}/releases/download/v{version}/{archive.name}',
        'length': str(archive.stat().st_size), 'type': 'application/octet-stream',
        f'{{{NS}}}edSignature': signature,
    })
    sign_feed(command, rss, output)


def add_release_notes(item, version):
    notes = json.loads((ROOT / 'docs' / 'releases' / f'{version}.appcast.json').read_text())
    if not notes['changes'] or not all(title.strip() and detail.strip() for title, detail in notes['changes']):
        raise ValueError('Updater notes require at least one complete change')
    for old in item.findall('description'):
        item.remove(old)
    changes = ''.join(f'<li><strong>{escape(title)}</strong><br>{escape(detail)}</li>'
                      for title, detail in notes['changes'])
    url = f'https://github.com/{REPO}/releases/tag/v{version}'
    html = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="color-scheme" content="light dark">
<style>
:root {{ color-scheme: light dark; }}
body {{ font: 13px/1.55 -apple-system, sans-serif; margin: 16px 20px; color: CanvasText; }}
h2 {{ font-size: 18px; margin: 0 0 8px; }}
ul {{ padding-left: 19px; }}
li {{ margin-bottom: 10px; }}
.notice {{ padding: 9px 11px; background: color-mix(in srgb, CanvasText 8%, Canvas); border-radius: 6px; }}
</style><body>
<h2>{escape(notes['heading'])}</h2>
<p>{escape(notes['summary'])}</p>
<ul>{changes}</ul>
<p class="notice">{escape(notes['notice'])}</p>
<p><a href="{url}">Read the full release notes</a></p>
</body></html>"""
    ET.SubElement(item, 'description', {f'{{{NS}}}format': 'html'}).text = html


def sign_feed(command, rss, output):
    ET.indent(rss)
    ET.ElementTree(rss).write(output, encoding='utf-8', xml_declaration=True)
    run(*command, output)
    run(*command, '--verify', output)


def refresh_feed_notes(tool, previous, output):
    if previous.resolve() == output.resolve():
        raise SystemExit('Use a separate output file for the updated feed')
    private_key = os.environ.pop('SPARKLE_ED_PRIVATE_KEY', '')
    if not private_key:
        raise SystemExit('Missing update signing key')
    with tempfile.TemporaryDirectory(prefix='promeftp-feed-') as directory:
        key_file = Path(directory) / 'sparkle.key'
        key_file.touch(mode=0o600)
        key_file.write_text(private_key + '\n')
        command = [str(tool), '--ed-key-file', str(key_file)]
        run(*command, '--verify', previous)
        rss = ET.parse(previous).getroot()
        for item in rss.findall('channel/item'):
            version = item.findtext(f'{{{NS}}}version')
            if not version or not re.fullmatch(r'\d+\.\d+\.\d+', version):
                raise SystemExit('Invalid update version')
            add_release_notes(item, version)
        sign_feed(command, rss, output)


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--feed-only':
        refresh_feed_notes(*(Path(arg).resolve() for arg in sys.argv[2:]))
    else:
        main()
