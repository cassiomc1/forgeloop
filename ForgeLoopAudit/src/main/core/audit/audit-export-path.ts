import { ForgeLoopAuditError } from '@shared/errors';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Validate an audit report destination. Reports are external artifacts by
 * default; writing beneath the audited project's protocol directory requires
 * an explicit caller opt-in and is still protected by exclusive file creation.
 */
export function validateAuditExportPath(
  destinationPath: string,
  projectRoot: string | null,
  allowProjectProtocolPath: boolean,
): string {
  if (!isAbsolute(destinationPath)) throw ForgeLoopAuditError.pathBoundaryViolation(destinationPath, 'audit export requires an absolute destination path');
  const outputPath = resolve(destinationPath);
  if (projectRoot && !allowProjectProtocolPath) {
    const protocolRoot = resolve(projectRoot, '.forgeloop');
    const pathRelativeToProtocol = relative(protocolRoot, outputPath);
    const isProtocolPath = pathRelativeToProtocol === ''
      || (!isAbsolute(pathRelativeToProtocol)
        && pathRelativeToProtocol !== '..'
        && !pathRelativeToProtocol.startsWith(`..${sep}`));
    if (isProtocolPath) {
      throw ForgeLoopAuditError.pathBoundaryViolation(outputPath, 'audit reports cannot overwrite ForgeLoop protocol artifacts by default');
    }
  }
  return outputPath;
}
