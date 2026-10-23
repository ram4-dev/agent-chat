import { AgentsPanel } from '../features/agents/AgentsPanel';
import { useCallback, useEffect, useState } from 'react';
import { loadLiveness, type LivenessState } from '../shared/liveness';
import { AuthPanel } from '../features/auth/AuthPanel';
import {
  loadSession,
  loginAccount,
  logout,
  registerAccount,
  type Credentials,
  type Registration,
  type SessionState,
} from '../features/auth/session';
import { GroupPanel } from '../features/groups/GroupPanel';
import { ChatContainer } from '../features/chat/ChatPanel';
import {
  acceptInvitation,
  createGroup,
  createInvitation,
  loadGroupDetail,
  loadGroups,
  removeMember,
  type GroupDetailState,
  type GroupsState,
  type InvitationState,
} from '../features/groups/transport';

/**
 * Presentational shell. It renders exactly what the container knows: no data
 * fetching, no side effects.
 */
export function AppShell({
  liveness,
  session,
  groups,
  detail,
  invitation,
  onRegister,
  onLogin,
  onLogout,
  onCreateGroup,
  onOpenGroup,
  onInvite,
  onAcceptInvitation,
  onRemoveMember,
}: {
  liveness: LivenessState;
  session: SessionState;
  groups: GroupsState;
  detail: GroupDetailState;
  invitation: InvitationState;
  onRegister(input: Registration): void;
  onLogin(input: Credentials): void;
  onLogout(): void;
  onCreateGroup(name: string): void;
  onOpenGroup(groupId: string): void;
  onInvite(groupId: string): void;
  onAcceptInvitation(token: string): void;
  onRemoveMember(groupId: string, memberId: string): void;
}) {
  return (
    <main>
      <h1>Agent Chat</h1>
      <p>{describeLiveness(liveness)}</p>
      <AuthPanel
        session={session}
        onRegister={onRegister}
        onLogin={onLogin}
        onLogout={onLogout}
      />
      {session.status === 'authenticated' && detail.status === 'ready' && (
        <ChatContainer
          groupId={detail.detail.group.id}
          groupName={detail.detail.group.name}
        />
      )}
      {session.status === 'authenticated' && <AgentsPanel
        {...(detail.status === 'ready' && detail.detail.role === 'admin' ? { groupId: detail.detail.group.id } : {})}
        onChanged={() => { if (detail.status === 'ready') onOpenGroup(detail.detail.group.id); }}
      />}
      {session.status === 'authenticated' && (
        <GroupPanel
          groups={groups}
          detail={detail}
          invitation={invitation}
          onCreateGroup={onCreateGroup}
          onOpenGroup={onOpenGroup}
          onInvite={onInvite}
          onAcceptInvitation={onAcceptInvitation}
          onRemoveMember={onRemoveMember}
        />
      )}
    </main>
  );
}

/**
 * Container.
 *
 * It owns every request and every piece of server state. Groups are reloaded
 * whenever the session becomes authenticated, so a signed-out visitor never
 * sees a stale membership list.
 */
export function App() {
  const [liveness, setLiveness] = useState<LivenessState>({ status: 'loading' });
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [groups, setGroups] = useState<GroupsState>({ status: 'loading' });
  const [detail, setDetail] = useState<GroupDetailState>({ status: 'loading' });
  const [invitation, setInvitation] = useState<InvitationState>({ status: 'idle' });

  const refreshGroups = useCallback(async () => {
    setGroups(await loadGroups());
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadLiveness().then((state) => {
      if (!cancelled) {
        setLiveness(state);
      }
    });
    void loadSession().then((state) => {
      if (!cancelled) {
        setSession(state);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session.status !== 'authenticated') {
      setGroups({ status: 'loading' });
      setDetail({ status: 'loading' });
      setInvitation({ status: 'idle' });
      return;
    }

    void loadGroups().then(setGroups);
  }, [session.status]);

  return (
    <AppShell
      liveness={liveness}
      session={session}
      groups={groups}
      detail={detail}
      invitation={invitation}
      onRegister={(input) => {
        void registerAccount(input).then(setSession);
      }}
      onLogin={(input) => {
        void loginAccount(input).then(setSession);
      }}
      onLogout={() => {
        void logout().then(() => setSession({ status: 'anonymous' }));
      }}
      onCreateGroup={(name) => {
        void createGroup(name).then(refreshGroups);
      }}
      onOpenGroup={(groupId) => {
        setInvitation({ status: 'idle' });
        void loadGroupDetail(groupId).then(setDetail);
      }}
      onInvite={(groupId) => {
        void createInvitation(groupId).then(setInvitation);
      }}
      onAcceptInvitation={(token) => {
        void acceptInvitation(token).then(refreshGroups);
      }}
      onRemoveMember={(groupId, memberId) => {
        void (detail.status === 'ready' && detail.detail.members.find((member) => member.id === memberId)?.kind === 'agent'
          ? fetch(`/api/groups/${groupId}/agents/${memberId}`, { method: 'DELETE' })
          : removeMember(groupId, memberId))
          .then(() => loadGroupDetail(groupId))
          .then(setDetail);
      }}
    />
  );
}

export function describeLiveness(liveness: LivenessState): string {
  switch (liveness.status) {
    case 'loading':
      return 'Server: checking';
    case 'ok':
      return `Server: ok (database: ${liveness.database})`;
    case 'error':
      return `Server: error (HTTP ${liveness.httpStatus})`;
    case 'unreachable':
      return 'Server: unreachable';
  }
}
