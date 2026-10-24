/** Explicit aliases of this server's root resource, sharing one token audience. */
export function isAgentResource(resource: unknown, issuer: string): resource is string {
  return resource === issuer || resource === `${issuer}/`;
}

export function agentResources(resource: unknown, issuer: string): string[] | undefined {
  const resources = resource === undefined ? [issuer] : Array.isArray(resource) ? resource : [resource];
  return resources.length > 0 && resources.every((value) => isAgentResource(value, issuer))
    ? [...new Set(resources)] as string[]
    : undefined;
}
