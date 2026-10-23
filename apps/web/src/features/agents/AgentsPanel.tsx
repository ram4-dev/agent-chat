import { useEffect, useState, type FormEvent } from 'react';
import { AGENT_PATHS, GROUP_PATHS, type OwnedAgentView } from '@agent-chat/contracts';

export function AgentsPanel({ groupId, onChanged }: { groupId?: string; onChanged(): void }) {
  const [agents, setAgents] = useState<OwnedAgentView[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [confirmation, setConfirmation] = useState<{ path: string; label: string }>();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const response = await fetch(AGENT_PATHS.collection);
      if (!response.ok) throw new Error('load failed');
      const data = await response.json() as { agents: OwnedAgentView[] };
      setAgents(data.agents);
    } catch { setError('Your agents could not be loaded.'); }
  }
  useEffect(() => { void refresh(); }, []);

  async function mutate(path: string, method: string, body?: object) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(path, { method, ...(body ? {
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      } : {}) });
      if (!response.ok) throw new Error('change failed');
      setConfirmation(undefined);
      await refresh(); onChanged();
    } catch { setError('The change could not be saved. Refresh and try again.'); }
    finally { setBusy(false); }
  }

  return <section aria-label="Your agents">
    <h2>Your agents</h2>
    <p>Connect an external MCP client to <code>{location.origin}/mcp</code> and approve an agent identity.
      Live reception requires a receiver running on your computer or server.</p>
    <button type="button" onClick={() => { void refresh(); }}>Refresh agents</button>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={(event: FormEvent) => {
      event.preventDefault(); void mutate(AGENT_PATHS.collection, 'POST', { name }); setName('');
    }}>
      <label htmlFor="agentName">New agent name</label>
      <input id="agentName" value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} />
      <button disabled={busy} type="submit">Create agent</button>
    </form>
    <ul aria-label="Owned agents">
      {agents.map((agent) => <li key={agent.id}>
        <h3>{agent.name}</h3><p>Status: {agent.status}</p>
        {agent.status === 'active' && <>
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void mutate(AGENT_PATHS.one(agent.id), 'PATCH', { name: data.get('name'), description: data.get('description'), avatarUrl: data.get('avatarUrl') || null });
          }}>
            <label>Name <input name="name" defaultValue={agent.name} required maxLength={60} /></label>
            <label>Description <input name="description" defaultValue={agent.description} maxLength={280} /></label>
            <label>Avatar URL <input name="avatarUrl" type="url" defaultValue={agent.avatarUrl ?? ''} /></label>
            <button disabled={busy} type="submit">Save profile</button>
          </form>
          {groupId && <button disabled={busy} type="button" onClick={() => { void mutate(GROUP_PATHS.agentMember(groupId, agent.id), 'POST'); }}>Add {agent.name} to selected group</button>}
          <button disabled={busy} type="button" onClick={() => setConfirmation({ path: AGENT_PATHS.one(agent.id), label: agent.name })}>Revoke agent {agent.name}</button>
        </>}
        <ul aria-label={`Connections for ${agent.name}`}>
          {agent.connections.map((connection) => <li key={connection.id}>
            Client <code>{connection.oauthClientId}</code>: {connection.revokedAt ? 'revoked' : 'authorized'}{' '}
            {!connection.revokedAt && agent.status === 'active' && <button disabled={busy} type="button" onClick={() => setConfirmation({ path: AGENT_PATHS.connection(connection.id), label: 'this client connection' })}>Revoke connection</button>}
          </li>)}
        </ul>
      </li>)}
    </ul>
    {confirmation && <div role="region" aria-label="Confirm revocation">
      <p>Revoke {confirmation.label}? Access and live reception will stop immediately.
        Previous messages keep the agent name and human owner.</p>
      <button disabled={busy} type="button" onClick={() => { void mutate(confirmation.path, 'DELETE'); }}>Confirm revocation</button>
      <button disabled={busy} type="button" onClick={() => setConfirmation(undefined)}>Cancel</button>
    </div>}
  </section>;
}
