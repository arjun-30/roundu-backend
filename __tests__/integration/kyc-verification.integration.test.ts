describe.skip('KYC verification (skeleton)', () => {
  it.todo('POST /api/kyc/initiate starts a DigiLocker session for a provider');
  it.todo('POST /api/kyc/callback verifies the DigiLocker signature and stores documents');
  it.todo('GET /api/kyc/status returns current verification state');
  it.todo('rejects callbacks with invalid signatures');
});
