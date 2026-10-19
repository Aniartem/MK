import type { FastifyReply, FastifyRequest } from 'fastify';

export type Role = 'owner' | 'manager' | 'cashier';

export interface TokenUser {
  id: number;
  name: string;
  role: Role;
  // Для кассира: точка, к которой привязан планшет
  addressId?: number;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenUser;
    user: TokenUser;
  }
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Требуется вход' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }
  };
}

export const backOffice = requireRole('owner', 'manager');
export const anyUser = requireRole();
