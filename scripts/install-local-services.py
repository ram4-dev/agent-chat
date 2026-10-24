#!/usr/bin/env python3
"""Package and run Agent Chat outside protected Desktop folders on macOS."""
import argparse
import datetime
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--database', required=True, help='Seed database for the first installation only')
parser.add_argument('--group', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
home = Path.home()
runtime = home / 'Library' / 'Application Support' / 'Agent Chat'
launch_agents = home / 'Library' / 'LaunchAgents'
launch_agents.mkdir(parents=True, exist_ok=True)
labels = ['local.agent-chat.server', 'local.agent-chat.receiver']
# Check both services before changing either. Their plists contain no credentials.
for label in labels:
    file = launch_agents / f'{label}.plist'
    if file.exists():
        previous = plistlib.loads(file.read_bytes())
        owner = previous.get('EnvironmentVariables', {}).get('AGENT_CHAT_SOURCE_ROOT')
        if owner != str(root) and previous.get('WorkingDirectory') != str(root):
            raise SystemExit(f'Refusing to replace unrelated service {label}')

runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
runtime.chmod(0o700)
release = runtime / 'releases' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
release.mkdir(parents=True, mode=0o700)
subprocess.run(['pnpm', '--filter', '@agent-chat/server', 'deploy', '--legacy', '--prod', str(release / 'server')], cwd=root, check=True)
shutil.copytree(root / 'apps/bridge/dist', release / 'bridge')
shutil.copytree(root / 'apps/web/dist', release / 'web')
shutil.copytree(root / 'db/migrations', release / 'migrations')
node = '/opt/homebrew/opt/node@22/bin/node'
subprocess.run([node, '-e', "const D=require('better-sqlite3'); const db=new D(':memory:'); db.close()"], cwd=release / 'server', check=True)

for label in labels:
    subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
state = runtime / 'data'
state.mkdir(parents=True, exist_ok=True, mode=0o700)
database = state / 'agent-chat.db'
if not database.exists():
    # SQLite backup includes WAL state, without printing or parsing application data.
    backup = "const D=(await import(process.argv[1])).default; const db=new D(process.argv[2],{readonly:true}); await db.backup(process.argv[3]); db.close();"
    subprocess.run([node, '--input-type=module', '-e', backup,
                    str(root / 'apps/server/node_modules/better-sqlite3/lib/index.js'),
                    str(Path(args.database).resolve()), str(database)], check=True)
    database.chmod(0o600)
    previous_state = root / '.local-state' / 'receiver'
    if previous_state.exists():
        shutil.copytree(previous_state, runtime / 'receiver', dirs_exist_ok=True, ignore=shutil.ignore_patterns('*.flock', '*.lock'))
logs = runtime / 'logs'
logs.mkdir(parents=True, exist_ok=True, mode=0o700)
path = f'{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
common = {'HOME': str(home), 'PATH': path, 'AGENT_CHAT_SOURCE_ROOT': str(root),
          'NODE_EXTRA_CA_CERTS': str(home / '.portless' / 'ca.pem')}
services = [
 (labels[0], ['/opt/homebrew/bin/portless', 'agent-chat', node, str(release / 'server/dist/main.js')],
  {**common, 'PUBLIC_ORIGIN': 'https://agent-chat.localhost', 'DATABASE_PATH': str(database),
   'MIGRATIONS_DIR': str(release / 'migrations'), 'WEB_DIST_DIR': str(release / 'web'),
   'LOG_LEVEL': 'warn', 'PORTLESS_SYNC_HOSTS': '0'}),
 (labels[1], [node, str(release / 'bridge/supervisor.js'), '--group', args.group, '--state', str(runtime / 'receiver')], common),
]
for label, command, env in services:
    file = launch_agents / f'{label}.plist'
    document = {'Label': label, 'ProgramArguments': command, 'WorkingDirectory': str(runtime),
                'EnvironmentVariables': env, 'RunAtLoad': True, 'KeepAlive': True,
                'ThrottleInterval': 10, 'ProcessType': 'Background',
                'StandardOutPath': str(logs / f'{label}.out.log'),
                'StandardErrorPath': str(logs / f'{label}.err.log')}
    with file.open('wb') as stream:
        plistlib.dump(document, stream)
    file.chmod(0o600)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(file)], check=True)
    print(f'Installed {label}')
# Legacy deploy can rewrite pnpm's workspace status metadata. Restore it offline.
repair_env = {**os.environ, 'CI': 'true', 'PATH': str(Path(node).parent) + ':' + os.environ.get('PATH', '')}
subprocess.run(['pnpm', 'install', '--offline', '--frozen-lockfile'], cwd=root, env=repair_env, check=True)
print(f'Runtime: {runtime}')
print(f'Database: {database}')
