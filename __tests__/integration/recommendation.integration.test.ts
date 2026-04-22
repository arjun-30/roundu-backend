describe.skip('recommendations (skeleton — "initial" stub)', () => {
  it.todo('GET /api/recommendations returns up to `limit` ranked services');
  it.todo('respects user preferences stored on the profile');
  it.todo('POST /api/recommendations/feedback records thumbs up/down');
  it.todo('falls back to a static list when vLLM is unreachable');
});
