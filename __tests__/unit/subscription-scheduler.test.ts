describe.skip('subscription-scheduler job (skeleton)', () => {
  it.todo('renews active subscriptions one day before expiry');
  it.todo('marks a subscription cancelled after Stripe reports a failed charge');
  it.todo('does not renew subscriptions the user has explicitly cancelled');
  it.todo('is idempotent — rerunning does not double-charge');
});
