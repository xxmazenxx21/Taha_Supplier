import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface SerializableTransactionOptions {
  /** Total attempts, including the first one. */
  maxRetries: number;
  maxWait: number;
  timeout: number;
}

/** Postgres aborted the transaction with a serialization failure (Prisma P2034). */
export function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

/**
 * Runs `fn` inside a SERIALIZABLE interactive transaction, retrying it from
 * scratch on a serialization failure. Any other error is rethrown untouched.
 * `onExhausted` builds the error thrown once every attempt has been used up.
 */
export async function runSerializableTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableTransactionOptions,
  onExhausted: () => Error,
): Promise<T> {
  for (let attempt = 0; attempt < options.maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: options.maxWait,
        timeout: options.timeout,
      });
    } catch (error) {
      if (isSerializationFailure(error) && attempt < options.maxRetries - 1) {
        continue;
      }
      throw error;
    }
  }

  throw onExhausted();
}
