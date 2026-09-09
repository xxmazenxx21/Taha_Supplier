// multer.ts
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import { getUploadDirectory, UploadFolder } from './upload-paths';

export const MAX_FILE_SIZE =  10* 1024 * 1024; // 5MB
export const ALLOWED_MIME_TYPES = /^image\/(jpeg|jpg|png|webp)$/;

export function multerOptions(folderName: UploadFolder) {
  return {
    storage: diskStorage({
      destination: (req, file, callback) => {
        const uploadPath = getUploadDirectory(folderName);

        if (!fs.existsSync(uploadPath)) {
          fs.mkdirSync(uploadPath, { recursive: true });
        }

        callback(null, uploadPath);
      },
      filename: (req, file, callback) => {
        const uniqueName = `${uuid()}${extname(file.originalname)}`;
        callback(null, uniqueName);
      },
    }),
    // Primary guard: rejects the file during the upload stream itself.
    // Oversized files are aborted and partial writes are discarded by Multer automatically.
    limits: { fileSize: MAX_FILE_SIZE },
    // Primary guard: rejects invalid mime types before any bytes are written to disk.
    fileFilter: (req, file, callback) => {
      if (!ALLOWED_MIME_TYPES.test(file.mimetype)) {
        return callback(
          new BadRequestException(
            `File "${file.originalname}" has an invalid type. Allowed: jpeg, jpg, png, webp`,
          ),
          false,
        );
      }
      callback(null, true);
    },
  };
}

/**
 * Secondary defense-in-depth validation: checks already-uploaded files for size
 * and mime type. The primary guar8d is in multerOptions (fileFilter + limits),
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
