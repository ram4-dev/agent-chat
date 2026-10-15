import { useState, type FormEvent } from 'react';
import type { GroupSummary } from '@agent-chat/contracts';
import { describeMember } from './transport';
import type { GroupDetailState, GroupsState, InvitationState } from './transport';

export interface GroupPanelProps {
  groups: GroupsState;
  detail: GroupDetailState;
  invitation: InvitationState;
  onCreateGroup(name: string): void;
  onOpenGroup(groupId: string): void;
  onInvite(groupId: string): void;
  onAcceptInvitation(token: string): void;
  onRemoveMember(groupId: string, memberId: string): void;
}

/**
 * Presentational group surface.
 *
 * It holds only the draft text of the two forms. Every request, every
 * authorization decision, and every refusal message belongs to the container,
 * so this component cannot disagree with the server.
 */
export function GroupPanel({
  groups,
  detail,
  invitation,
  onCreateGroup,
  onOpenGroup,
  onInvite,
  onAcceptInvitation,
  onRemoveMember,
}: GroupPanelProps) {
  const [groupName, setGroupName] = useState('');
  const [inviteToken, setInviteToken] = useState('');

  return (
    <section aria-label="Groups">
      <h2>Private groups</h2>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onCreateGroup(groupName);
          setGroupName('');
        }}
      >
        <label htmlFor="groupName">New group name</label>
        <input
          id="groupName"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
        />
        <button type="submit">Create group</button>
      </form>

      <h3>Your groups</h3>
      <p role="status">{describeGroups(groups)}</p>
      {groups.status === 'ready' && (
        <ul>
          {groups.groups.map((group: GroupSummary) => (
            <li key={group.id}>
              <button type="button" onClick={() => onOpenGroup(group.id)}>
                {group.name}
              </button>{' '}
              <span>({group.role})</span>
            </li>
          ))}
        </ul>
      )}

      {detail.status === 'ready' && (
        <div aria-label="Selected group">
          <h3>{detail.detail.group.name}</h3>
          <p>Your role: {detail.detail.role}</p>
          <ul aria-label="Members">
            {detail.detail.members.map((member) => (
              <li key={member.id}>
                {describeMember(member)}{' '}
                {detail.detail.role === 'admin' && <button
                  type="button"
                  onClick={() => onRemoveMember(detail.detail.group.id, member.id)}
                >
                  Remove
                </button>}
              </li>
            ))}
          </ul>
          {detail.detail.role === 'admin' && (
            <button type="button" onClick={() => onInvite(detail.detail.group.id)}>
              Create invitation link
            </button>
          )}
          {invitation.status === 'ready' && (
            <p aria-label="Invitation">
              Invitation token: <code>{invitation.invitation.token}</code> — expires{' '}
              {invitation.invitation.expiresAt}
            </p>
          )}
          {invitation.status === 'rejected' && (
            <p role="status">The invitation could not be created ({invitation.code}).</p>
          )}
        </div>
      )}
      {detail.status === 'rejected' && (
        <p role="status">That group is not available to you ({detail.code}).</p>
      )}

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onAcceptInvitation(inviteToken);
          setInviteToken('');
        }}
      >
        <label htmlFor="inviteToken">Invitation token</label>
        <input
          id="inviteToken"
          value={inviteToken}
          onChange={(event) => setInviteToken(event.target.value)}
        />
        <button type="submit">Join group</button>
      </form>
    </section>
  );
}

/** One truthful sentence for the group list. */
export function describeGroups(groups: GroupsState): string {
  switch (groups.status) {
    case 'loading':
      return 'Loading your groups…';
    case 'ready':
      return groups.groups.length === 0
        ? 'You are not in any group yet.'
        : `You are in ${groups.groups.length} group(s).`;
    case 'error':
      return 'Your groups could not be loaded.';
  }
}
