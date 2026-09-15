import { resolve } from 'node:path';

export enum UploadFolder {
  BRANDS = 'brands',
  CATEGORIES = 'categories',
  PRODUCTS = 'products',
}

const uploadsRoot = resolve(process.cwd(), 'uploads');

export function getUploadDirectory(folder: UploadFolder): string {
  return resolve(uploadsRoot, folder);
}

export function getUploadPublicPath(
  folder: UploadFolder,
  filename: string,
): string {
  return `/uploads/${folder}/${filename}`;
}
