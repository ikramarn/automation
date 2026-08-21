/**
 * Promisified delay utility.
 *
 * Isolated into its own module so tests can mock it via vi.mock() without
 * affecting other exports.  When mocked, delay() resolves immediately,
 * preventing real sleeps during test execution.
 */
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
