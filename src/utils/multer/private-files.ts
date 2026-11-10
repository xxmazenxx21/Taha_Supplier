import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { getErrorMessage } from '../error-message';
import { resolvePrivateUploadPath } from './upload-paths';

/**
 * Best-effort removal of a private upload. A missing or unresolvable file
 * must never turn into a request failure.
 */
export async function deletePrivateFile(
  relativePath: string,
  logger: Logger,
): Promise<void> {
  const absolutePath = resolvePrivateUploadPath(relativePath);
  if (!absolutePath) {
    logger.warn(
      `Refusing to delete payment proof outside private-uploads: ${relativePath}`,
    );
    return;
  }

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(
        `Could not delete payment proof ${relativePath}: ${getErrorMessage(error)}`,
      );
    }
  }
}
