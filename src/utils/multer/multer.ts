// multer.ts
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import { getUploadDirectory, UploadFolder } from './upload-paths';

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
  };
}
