describe.skip('cashback service (skeleton — fill in when rules land)', () => {
  it.todo('credits configured % of booking total on completion');
  it.todo('caps cashback at per-booking maximum');
  it.todo('does not double-credit on repeated completion events');
  it.todo('writes a wallet_transactions row with type=credit');
  it.todo('skips cashback when the booking was cancelled or refunded');
});
