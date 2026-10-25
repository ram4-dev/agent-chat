import { createNativeStatusModule, type NativeStatusModule } from './modules/native-status/index.js';
import { createNativeDeliveryModule, type NativeDeliveryModule } from './modules/native-delivery/index.js';
import { createNativeAccessModule, type NativeAccessModule } from './modules/native-access/index.js';
import { createAutomationModule, type AutomationModule } from './modules/automation/index.js';
import { runImmediateTransaction } from './persistence/client.js';
import { createSqliteAuditRepository } from './persistence/audit-repository.js';
import { createCredentialRepository } from './persistence/credential-repository.js';
import { createAuthModule, createArgon2PasswordHasher } from './modules/auth/index.js';
import { createAgentsModule } from './modules/agents/index.js';
import { createGroupsModule } from './modules/groups/index.js';
import { createInboxModule } from './modules/inbox/index.js';
import { createMessagingModule } from './modules/messaging/index.js';
import { createLiveDeliveryHub, type LiveDeliveryHub } from './realtime/hub.js';
import { createIdentityModule, generateUuidV7 } from './modules/identity/index.js';
import { createSqliteUserRepository } from './persistence/identity-repository.js';
import { createSqliteSessionRepository } from './persistence/session-repository.js';
import { createSqliteGroupRepository } from './persistence/groups-repository.js';
import { createSqliteInvitationRepository } from './persistence/invitations-repository.js';
import { createSqliteInboxRepository } from './persistence/inbox-repository.js';
import { createSqliteMessageRepository } from './persistence/messages-repository.js';
import {
  createSqliteAgentRepository,
  createSqliteConnectionRepository,
} from './persistence/agents-repository.js';
import type { DatabaseHandle } from './persistence/index.js';
import type { AuthModule } from './modules/auth/index.js';
import type { AgentsModule } from './modules/agents/index.js';
import type { GroupsModule } from './modules/groups/index.js';
import type { InboxModule } from './modules/inbox/index.js';
import type { MessagingModule } from './modules/messaging/index.js';
import type { IdentityModule } from './modules/identity/index.js';
import type { NotificationsModule } from './notifications/module.js';

export type AsyncPort<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : T[K];
};

export type ApplicationHub = Omit<LiveDeliveryHub, 'receiverIsConnected'> & {
  receiverIsConnected(agentId: string): boolean | Promise<boolean>;
};

export interface SocketLeases {
  reserve(principal: string, socketId: string, max: number, agentId?: string, connectionId?: string): Promise<boolean>;
  renew(socketId: string): Promise<boolean>;
  release(socketId: string): Promise<void>;
}

export interface ApplicationServices {
  notifications?: NotificationsModule;
  identity: AsyncPort<IdentityModule>;
  auth: AsyncPort<AuthModule>;
  agents: AsyncPort<AgentsModule>;
  groups: AsyncPort<GroupsModule>;
  inbox: AsyncPort<InboxModule>;
  messaging: AsyncPort<MessagingModule>;
  hub: ApplicationHub;
  socketLeases?: SocketLeases;
  /** Native execution currently requires the durable local runtime backend. */
  automation?: AutomationModule;
  nativeAccess?: NativeAccessModule;
  nativeDelivery?: NativeDeliveryModule;
  nativeStatus?: NativeStatusModule;
}

export interface LocalApplicationServices {
  identity: IdentityModule;
  auth: AuthModule;
  agents: AgentsModule;
  groups: GroupsModule;
  inbox: InboxModule;
  messaging: MessagingModule;
  hub: LiveDeliveryHub;
  automation: AutomationModule;
  nativeAccess: NativeAccessModule;
  nativeDelivery: NativeDeliveryModule;
  nativeStatus: NativeStatusModule;
}

/**
 * Composition root.
 *
 * Adapters receive modules that already hold their ports; nothing below this
 * function decides which SQLite statement or which hash function is used. That
 * keeps a use case testable with fakes and keeps the driver choice out of the
 * modules.
 */
export function createServices(database: DatabaseHandle): LocalApplicationServices {
  const identity = createIdentityModule({
    users: createSqliteUserRepository(database.sqlite),
    clock: SYSTEM_CLOCK,
    generateId: () => generateUuidV7(),
  });

  const auth = createAuthModule({
    identity,
    sessions: createSqliteSessionRepository(database.sqlite),
    passwords: createArgon2PasswordHasher(),
    clock: SYSTEM_CLOCK,
  });

  const groupRepository = createSqliteGroupRepository(database.sqlite);

  // Agents come before groups: admitting an agent asks whether it is active,
  // and the group module receives that as a port rather than reaching into the
  // agents module itself.
  const hub = createLiveDeliveryHub();
  const audit = createSqliteAuditRepository(database.sqlite);
  const agents = createAgentsModule({
    transaction: (operation) => runImmediateTransaction(database.sqlite, operation),
    audit, credentials: createCredentialRepository(database.sqlite),
    closeReceivers: (target) => hub.closeReceivers(target),
    agents: createSqliteAgentRepository(database.sqlite),
    connections: createSqliteConnectionRepository(database.sqlite),
    clock: SYSTEM_CLOCK,
    generateId: () => generateUuidV7(),
  });

  const groups = createGroupsModule({
    groups: groupRepository,
    invitations: createSqliteInvitationRepository(database.sqlite),
    clock: SYSTEM_CLOCK,
    generateId: () => generateUuidV7(),
    agentLookup: { isActive: (agentId) => agents.isActiveAgent(agentId) },
  });

  const inbox = createInboxModule({
    inbox: createSqliteInboxRepository(database.sqlite),
    // Reading an event re-checks the same membership question as reading a
    // message, through the same repository.
    access: {
      agentRoleFor: (groupId, agentId) => groupRepository.agentRoleFor(groupId, agentId),
    },
    clock: SYSTEM_CLOCK,
  });

  const messaging = createMessagingModule({
    messages: createSqliteMessageRepository(database.sqlite, () => generateUuidV7(), audit),
    membership: {
      humanRoleFor: (groupId, userId) =>
        groupRepository.findHumanMembership(groupId, userId)?.role,
      agentRoleFor: (groupId, agentId) => groupRepository.agentRoleFor(groupId, agentId),
      agentRecipientsOf: (groupId) =>
        groupRepository.listAgentMembers(groupId).map((member) => member.agentId).filter((id) => agents.isActiveAgent(id)),
    },
    clock: SYSTEM_CLOCK,
    generateId: () => generateUuidV7(),
  });

  const automation = createAutomationModule(database.sqlite, { agents, groups, inbox, messaging, hub });
  const nativeAccess = createNativeAccessModule(database.sqlite, { agents, groups, messaging, hub, closeReceivers: (connectionId) => hub.closeReceivers({ connectionId }) });
  const nativeDelivery = createNativeDeliveryModule(database.sqlite, nativeAccess, { agents, groups, messaging, inbox, hub });
  const nativeStatus = createNativeStatusModule(database.sqlite, { agents, groups, nativeAccess });
  return { identity, auth, agents, groups, inbox, messaging, hub, automation, nativeAccess, nativeDelivery, nativeStatus };
}

const SYSTEM_CLOCK = { now: (): Date => new Date() };
