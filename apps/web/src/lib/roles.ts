export type Role = 'owner' | 'collaborator' | 'viewer' | 'candidate';

const POWER: Record<Role, number> = {
  owner: 4,
  collaborator: 3,
  candidate: 2,
  viewer: 1,
};

export function atLeast(role: string, min: Role): boolean {
  const r = role as Role;
  if (!(r in POWER)) return false;
  return POWER[r] >= POWER[min];
}

export function canEditRole(role: string): boolean {
  return atLeast(role, 'collaborator');
}

export function canManageRole(role: string): boolean {
  return role === 'owner';
}
