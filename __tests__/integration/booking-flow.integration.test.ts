describe.skip('booking flow (skeleton — full HTTP lifecycle)', () => {
  it.todo('POST /api/bookings creates a pending booking');
  it.todo('provider can accept → status transitions pending → confirmed');
  it.todo('cancellation within 3h → 0% refund (integrates with cancellation-slabs)');
  it.todo('cannot schedule a booking in the past');
  it.todo('applying an offer code deducts the discount from the quote');
  it.todo('completed bookings trigger cashback + rating prompt');
});
