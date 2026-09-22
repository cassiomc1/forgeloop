export const TEST_UTILITY_BATCH_SIZE = 8;

export function batchTests(tests = [], size = TEST_UTILITY_BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < tests.length; index += size) batches.push(tests.slice(index, index + size));
  return batches;
}

export function buildTestSemanticState(tests = []) {
  return {
    tests: tests.map(({ testId, file, framework, suite, name, line, sourceSummary, targets, runtimeMs, uniqueBranches, signals }) => ({
      testId, file, framework, suite, name, line, sourceSummary, targets, runtimeMs, uniqueBranches, signals,
    })),
  };
}
