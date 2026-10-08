// multer.ts
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import type { Request } from 'express';
import type { FileInterceptor } from '@nestjs/platform-express';
import {
  getPrivateUploadDirectory,
  getUploadDirectory,
  PrivateUploadFolder,
  UploadFolder,
} from './upload-paths';

/**
 * The options type Nest's file interceptors actually accept, derived from
 * FileInterceptor so it stays correct without importing Nest internals.
 * Annotating the factories below with it makes TypeScript verify fileFilter
 * against Nest's contract here, instead of failing at every call site.
 */
type NestMulterOptions = NonNullable<Parameters<typeof FileInterceptor>[1]>;

/**
 * Nest declares the filter callback with this exact single signature.
 * @types/multer's `FileFilterCallback` is an overloaded interface (one of its
 * overloads takes a single argument) and is therefore NOT interchangeable with
 * it — using that type here is what broke assignability.
 */
type NestFileFilterCallback = (
  error: Error | null,
  acceptFile: boolean,
) => void;

/** Minimal shape satisfied by both Nest's inline file type and Express.Multer.File. */
type FilterableFile = { originalname: string; mimetype: string };

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 5MB
export const ALLOWED_MIME_TYPES = /^image\/(jpeg|jpg|png|webp)$/;

function diskStorageInto(resolveDirectory: () => string) {
  return diskStorage({
    destination: (
      req: Request,
      file: Express.Multer.File,
      callback: (error: Error | null, destination: string) => void,
    ) => {
      const uploadPath = resolveDirectory();

      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      callback(null, uploadPath);
    },
    filename: (
      req: Request,
      file: Express.Multer.File,
      callback: (error: Error | null, filename: string) => void,
    ) => {
      const uniqueName = `${uuid()}${extname(file.originalname)}`;
      callback(null, uniqueName);
    },
  });
}

function imageUploadGuards(): Pick<NestMulterOptions, 'limits' | 'fileFilter'> {
  return {
    // Primary guard: rejects the file during the upload stream itself.
    // Oversized files are aborted and partial writes are discarded by Multer automatically.
    limits: { fileSize: MAX_FILE_SIZE },
    // Primary guard: rejects invalid mime types before any bytes are written to disk.
    fileFilter: (
      req: unknown,
      file: FilterableFile,
      callback: NestFileFilterCallback,
    ) => {
      if (!ALLOWED_MIME_TYPES.test(file.mimetype)) {
        callback(
          new BadRequestException(
            `File "${file.originalname}" has an invalid type. Allowed: jpeg, jpg, png, webp`,
          ),
          false,
        );
        return;
      }
      callback(null, true);
    },
  };
}

export function multerOptions(folderName: UploadFolder): NestMulterOptions {
  return {
    storage: diskStorageInto(() => getUploadDirectory(folderName)),
    ...imageUploadGuards(),
  };
}

/**
 * Same type/size guards as multerOptions, but writes under private-uploads/,
 * which is deliberately outside the statically served uploads root.
 */
export function privateMulterOptions(
  folderName: PrivateUploadFolder,
): NestMulterOptions {
  return {
    storage: diskStorageInto(() => getPrivateUploadDirectory(folderName)),
    ...imageUploadGuards(),
  };
}

/**
 * Secondary defense-in-depth validation: checks already-uploaded files for size
 * and mime type. The primary guard is in multerOptions (fileFilter + limits),
 * which rejects files before/during writing to disk. This function catches any
 * edge cases that slip through (e.g. mime spoofing that Multer missed).
 */
export function validateImageFiles(files: Express.Multer.File[]): void {
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File "${file.originalname}" exceeds the 5MB size limit`,
      );
    }
    if (!ALLOWED_MIME_TYPES.test(file.mimetype)) {
      throw new BadRequestException(
        `File "${file.originalname}" has an invalid type. Allowed: jpeg, jpg, png, webp`,
      );
    }
  }
}
