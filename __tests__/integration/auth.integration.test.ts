describe.skip('auth flow (skeleton — fill in as endpoints solidify)', () => {
  it.todo('POST /api/auth/register requests an OTP via MSG91 and stores the hash');
  it.todo('POST /api/auth/verify-otp returns access + refresh tokens on success');
  it.todo('rejects expired OTPs');
  it.todo('rate-limits OTP send to 3/hour per phone number');
  it.todo('POST /api/auth/refresh rotates the refresh token');
  it.todo('POST /api/auth/logout invalidates the refresh token');
});
