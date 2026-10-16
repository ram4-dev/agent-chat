import { createAuthModule, createArgon2PasswordHasher } from './modules/auth/index.js';
import { createAgentsModule } from './modules/agents/index.js';
import { createGroupsModule } from './modules/groups/index.js';
import { createMessagingModule } from './modules/messaging/index.js';
import { createLiveDeliveryHub, type LiveDeliveryHub } from './realtime/hub.js';
import { createIdentityModule, generateUuidV7 } from './modules/identity/index.js';
import { createSqliteUserRepository } from './persistence/identity-repository.js';
import { createSqliteSessionRepository } from './persistence/session-repository.js';
import { createSqliteGroupRepository } from './persistence/groups-repository.js';
import { createSqliteInvitationRepository } from './persistence/invitations-repository.js';
import { createSqliteMessageRepository } from './persistence/messages-repository.js';
import {
  createSqliteAgentRepository,
  createSqliteConnectionRepository,
} from './persistence/agents-repository.js';
import type { DatabaseHandle } from './persistence/index.js';
import type { AuthModule } from './modules/auth/index.js';
import type { AgentsModule } from './modules/agents/index.js';
import type { GroupsModule } from './modules/groups/index.js';
import type { MessagingModule } from './modules/messaging/index.js';
import type { IdentityModule } from './modules/identity/index.js';

export interface ApplicationServices {
  identity: IdentityModule;
  auth: AuthModule;
  agents: AgentsModule;
  groups: GroupsModule;
  messaging: MessagingModule;
  hub: LiveDeliveryHub;
}

/**
 * Composition root.
 *
 * Adapters receive modules that already hold their ports; nothing below this
 * function decides which SQLite statement or which hash function is used. That
 * keeps a use case testable with fakes and keeps the driver choice out of the
 * modules.
 */
export function createServices(database: DatabaseHandle): ApplicationServices {
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
  const agents = createAgentsModule({
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

  const hub = createLiveDeliveryHub();

  const messaging = createMessagingModule({
    messages: createSqliteMessageRepository(database.sqlite),
    membership: {
      humanRoleFor: (groupId, userId) =>
        groupRepository.findHumanMembership(groupId, userId)?.role,
      agentRoleFor: (groupId, agentId) => groupRepository.agentRoleFor(groupId, agentId),
    },
    clock: SYSTEM_CLOCK,
    generateId: () => generateUuidV7(),
  });

  return { identity, auth, agents, groups, messaging, hub };
}

const SYSTEM_CLOCK = { now: (): Date => new Date() };
