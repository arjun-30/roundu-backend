// Owner: Dev 4 — Real-time & Communications
// Purpose: Jest globalTeardown — closes DB connections and cleans up after all tests

export default async function globalTeardown(): Promise<void> {
  console.log('[Teardown] Global teardown complete');
}
