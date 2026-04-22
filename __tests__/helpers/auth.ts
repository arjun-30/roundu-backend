import { signAccessToken, AccessTokenPayload } from '../../src/utils/jwt';

export function tokenFor(user: {
  id: string;
  role?: 'user' | 'provider' | 'admin';
  phone?: string;
}): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    role: user.role ?? 'user',
    phone: user.phone ?? '+910000000000',
  };
  return signAccessToken(payload);
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Used by middleware unit tests that need to seed req.user directly. */
export function mockUser(user: {
  id: string;
  role?: 'user' | 'provider' | 'admin';
  phone?: string;
}): AccessTokenPayload & { id: string } {
  return {
    sub: user.id,
    id: user.id,
    role: user.role ?? 'user',
    phone: user.phone ?? '+910000000000',
  };
}
