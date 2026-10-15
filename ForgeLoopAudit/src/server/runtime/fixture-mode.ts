export function isFixtureProjectMode(packaged: boolean, environment: NodeJS.ProcessEnv): boolean {
  return !packaged
    && environment.FORGELOOP_AUDIT_SMOKE === '1'
    && Boolean(environment.FORGELOOP_AUDIT_FIXTURE_PROJECT);
}
