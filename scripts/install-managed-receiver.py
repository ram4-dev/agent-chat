#!/usr/bin/env python3
"""Install only the cloud-connected receiver; preserve existing local server services."""
import argparse
import datetime
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--origin', default='https://agent-chat-preview-kappa.vercel.app')
parser.add_argument('--prepare-only', action='store_true', help='Package the receiver without authorizing or starting it')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
home = Path.home()
runtime = home / 'Library/Application Support/Agent Chat Managed'
runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
runtime.chmod(0o700)
launch_agents = home / 'Library/LaunchAgents'
label = 'local.agent-chat.managed-receiver'
plist = launch_agents / f'{label}.plist'
if plist.exists():
    previous = plistlib.loads(plist.read_bytes())
    if previous.get('WorkingDirectory') != str(runtime):
        raise SystemExit('Refusing to overwrite an unrelated launch service')
node = '/opt/homebrew/opt/node@22/bin/node'
if not Path(node).exists() or not shutil.which('codex') or not shutil.which('python3'):
    raise SystemExit('Node 22, Codex and Python 3 must be installed')
release = runtime / 'releases' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
release.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
subprocess.run(['pnpm', '--filter', '@agent-chat/bridge', 'deploy', '--legacy', '--prod', str(release)], cwd=root, check=True)
state = runtime / 'state'
state.mkdir(parents=True, exist_ok=True, mode=0o700)
logs = runtime / 'logs'
logs.mkdir(parents=True, exist_ok=True, mode=0o700)
command = [node, str(release / 'dist/managed/main.js'), '--origin', args.origin, '--state', str(state)]
environment = {**os.environ, 'PATH': str(Path(node).parent) + ':' + os.environ.get('PATH', '')}
# pnpm legacy deploy can update workspace metadata. Restore dependencies before returning.
subprocess.run(['pnpm', 'install', '--offline', '--frozen-lockfile'], cwd=root,
               env={**environment, 'CI': 'true'}, check=True)
if args.prepare_only:
    print(f'Packaged receiver: {release}')
    raise SystemExit(0)
subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    subprocess.run(command + ['--login'], env=environment, cwd=runtime, check=True)
except (subprocess.CalledProcessError, KeyboardInterrupt):
    if plist.exists():
        subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)], check=False)
    raise
launch_agents.mkdir(parents=True, exist_ok=True)
document = {
    'Label': label, 'ProgramArguments': command, 'WorkingDirectory': str(runtime),
    'EnvironmentVariables': {'HOME': str(home), 'PATH': os.environ.get('PATH', ''),
                             'AGENT_CHAT_SOURCE_ROOT': str(root)},
    'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10, 'ProcessType': 'Background',
    'StandardOutPath': str(logs / 'receiver.out.log'), 'StandardErrorPath': str(logs / 'receiver.err.log'),
}
with plist.open('wb') as stream:
    plistlib.dump(document, stream)
plist.chmod(0o600)
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)], check=True)
print(f'Installed {label}. Ready is confirmed only after receiver.ready in its log.')
