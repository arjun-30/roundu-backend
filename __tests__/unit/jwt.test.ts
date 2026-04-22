import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../../src/utils/jwt';

const accessPayload: AccessTokenPayload = {
  sub: 'u-1',
  role: 'user',
  phone: '+919000000001',
};

const refreshPayload: RefreshTokenPayload = {
  sub: 'u-1',
  tokenFamily: 'family-1',
};

describe('jwt utility', () => {
  describe('access tokens', () => {
    it('signs and verifies a valid access token', () => {
      const token = signAccessToken(accessPayload);
      const payload = verifyAccessToken(token);
      expect(payload.sub).toBe('u-1');
      expect(payload.role).toBe('user');
      expect(payload.phone).toBe('+919000000001');
      expect(payload.iss).toBe('roundu');
      expect(payload.aud).toBe('roundu-client');
    });

    it('rejects a tampered token', () => {
      const token = signAccessToken(accessPayload);
      const parts = token.split('.');
      const bad = [parts[0], parts[1], 'AAA' + parts[2].slice(3)].join('.');
      expect(() => verifyAccessToken(bad)).toThrow();
    });

    it('rejects an access token verified as refresh (different secret)', () => {
      const token = signAccessToken(accessPayload);
      expect(() => verifyRefreshToken(token)).toThrow();
    });

    it('rejects a token with the wrong audience', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(accessPayload, process.env.JWT_ACCESS_SECRET, {
        issuer: 'roundu',
        audience: 'other-client',
        expiresIn: '15m',
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });

    it('rejects a token with the wrong issuer', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(accessPayload, process.env.JWT_ACCESS_SECRET, {
        issuer: 'attacker',
        audience: 'roundu-client',
        expiresIn: '15m',
      });
      expect(() => verifyAccessToken(token)).toThrow();
    });
  });

  describe('refresh tokens', () => {
    it('signs and verifies a valid refresh token', () => {
      const token = signRefreshToken(refreshPayload);
      const payload = verifyRefreshToken(token);
      expect(payload.sub).toBe('u-1');
      expect(payload.tokenFamily).toBe('family-1');
    });

    it('refresh token fails verification with access verifier', () => {
      const token = signRefreshToken(refreshPayload);
      expect(() => verifyAccessToken(token)).toThrow();
    });
  });

  describe('decodeToken', () => {
    it('returns payload without verifying signature', () => {
      const token = signAccessToken(accessPayload);
      const decoded = decodeToken(token);
      expect(decoded?.sub).toBe('u-1');
    });

    it('returns null for garbage input', () => {
      expect(decodeToken('not-a-token')).toBeNull();
    });
  });
});
