import type { Pad, PadMember } from '@prisma/client';
import { prisma } from '../db.js';

export type Role = 'owner' | 'collaborator' | 'viewer' | 'candidate';

const POWER: Record<Role, number> = {
  owner: 4,
  collaborator: 3,
  candidate: 2,
  viewer: 1,
};

export interface PadAccess {
  pad: Pad;
  role: Role;
  member: PadMember;
}

export async function getPadAccess(slug: string, userId: string): Promise<PadAccess | null> {
  const pad = await prisma.pad.findUnique({ where: { slug } });
  if (!pad) return null;
  if (pad.ownerId === userId) {
    const member =
      (await prisma.padMember.findUnique({
        where: { padId_userId: { padId: pad.id, userId } },
      })) ??
      (await prisma.padMember.create({
        data: { padId: pad.id, userId, role: 'owner' },
      }));
    return { pad, role: 'owner', member };
  }
  const member = await prisma.padMember.findUnique({
    where: { padId_userId: { padId: pad.id, userId } },
  });
  if (!member) return null;
  return { pad, role: member.role as Role, member };
}

export function atLeast(role: Role, min: Role): boolean {
  return POWER[role] >= POWER[min];
}

export function canEdit(role: Role): boolean {
  return atLeast(role, 'collaborator');
}

export function canManage(role: Role): boolean {
  return role === 'owner';
}

export function canView(role: Role): boolean {
  return atLeast(role, 'viewer');
}
