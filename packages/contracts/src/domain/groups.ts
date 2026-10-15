/**
 * Bounded limits for private groups and invitations.
 *
 * The approved Program Design keeps every limit in the shared contracts package
 * so the browser, the server, the tests, and any later adapter cannot disagree
 * about what is acceptable.
 */
export const GROUPS_LIMITS = {
  /** Bounded group name, matching the non-empty check constraint in SQLite. */
  GROUP_NAME_MAX_LENGTH: 80,
  /**
   * How long an invitation link stays valid.
   *
   * Seven days is long enough to reach someone out of band and short enough
   * that a leaked link stops working without an explicit revocation step.
   */
  INVITATION_TTL_SECONDS: 7 * 24 * 60 * 60,
} as const;

export type GroupsLimits = typeof GROUPS_LIMITS;

/** A member's authority inside one private group. */
export const GROUP_ROLES = ['admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** The principal a membership row can belong to. */
export const MEMBER_KINDS = ['human', 'agent'] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];
