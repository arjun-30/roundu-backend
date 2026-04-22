describe.skip('Stripe payments (skeleton — full webhook flow)', () => {
  it.todo('POST /api/payments/intent creates a Stripe PaymentIntent for a booking');
  it.todo('POST /api/payments/webhook verifies the Stripe signature');
  it.todo('rejects webhooks with invalid or missing signatures');
  it.todo('idempotently handles duplicate payment_intent.succeeded events');
  it.todo('triggers cashback credit after payment succeeds');
});
