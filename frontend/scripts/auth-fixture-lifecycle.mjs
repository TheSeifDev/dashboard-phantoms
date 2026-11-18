/**
 * Run the disposable Auth lifecycle after fixture seeding succeeds.
 *
 * The callbacks are intentionally injected so failure paths can be exercised
 * without starting a runner, browser, local services, or real fixtures.
 */
export async function runAuthFixtureLifecycle({
  seeded,
  messageIds,
  trackFixtureMessages,
  startFixtureBridge,
  spawnPreview,
  waitForPreview,
  runTests,
  stopPreview,
  closeBridge,
  cleanupFixtures,
  finalizeEvidence,
}) {
  let bridge;
  let preview;
  let primaryError = null;
  let shutdownError = null;
  let cleanupError = null;
  let finalizationError = null;
  let cleanupStatus = 'not-started';

  try {
    // This is the first operation after seedFixtures and is covered by the
    // same finalizer as the bridge, preview, browser, and cleanup operations.
    await trackFixtureMessages(seeded.fixture, messageIds);
    bridge = await startFixtureBridge(seeded, messageIds);
    preview = await spawnPreview(seeded, bridge);
    await waitForPreview(seeded, bridge, preview);
    await runTests(seeded, bridge, preview, messageIds);
  } catch (error) {
    // Keep the original setup/browser error object and rethrow it unchanged at
    // the call site after cleanup diagnostics have been reported separately.
    primaryError = error;
  } finally {
    try {
      await stopPreview(preview);
    } catch (error) {
      shutdownError ??= error;
    }

    try {
      await closeBridge(bridge);
    } catch (error) {
      shutdownError ??= error;
    }

    try {
      await cleanupFixtures(seeded.service, seeded.admin, seeded.fixture, messageIds);
      cleanupStatus = 'passed';
    } catch (error) {
      cleanupStatus = 'failed';
      cleanupError = error;
    }

    try {
      finalizeEvidence(cleanupStatus);
    } catch (error) {
      finalizationError = error;
    }
  }

  return {
    bridge,
    preview,
    primaryError,
    shutdownError,
    cleanupError,
    finalizationError,
    cleanupStatus,
  };
}
