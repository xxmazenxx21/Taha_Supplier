import { resolve, sep } from 'node:path';

export enum UploadFolder {
  BRANDS = 'brands',
  CATEGORIES = 'categories',
  PRODUCTS = 'products',
  SUB_CATEGORY = 'sub-category',
  BANNERS = 'banners',
}

/**
 * Folders under private-uploads/. These are never served statically — files
 * here are only readable through an endpoint that checks ownership/role.
 */
export enum PrivateUploadFolder {
  PAYMENT_PROOFS = 'payment-proofs',
}

const uploadsRoot = resolve(process.cwd(), 'uploads');
const privateUploadsRoot = resolve(process.cwd(), 'private-uploads');

export function getUploadDirectory(folder: UploadFolder): string {
  return resolve(uploadsRoot, folder);
}

export function getUploadPublicPath(
  folder: UploadFolder,
  filename: string,
): string {
  return `/uploads/${folder}/${filename}`;
}

export function getPrivateUploadDirectory(folder: PrivateUploadFolder): string {
  return resolve(privateUploadsRoot, folder);
}

/**
 * The value stored in the database. Relative and without a leading slash so it
 * can never be confused with a public `/uploads/...` URL.
 */
export function getPrivateUploadRelativePath(
  folder: PrivateUploadFolder,
  filename: string,
): string {
  return `private-uploads/${folder}/${filename}`;
}

/**
 * Resolves a stored relative path to an absolute one, returning null if it
 * would escape private-uploads/. Guards against a traversal payload ever
 * reaching res.sendFile or fs.unlink.
 */
export function resolvePrivateUploadPath(relativePath: string): string | null {
  const absolute = resolve(process.cwd(), relativePath);

  if (
    absolute !== privateUploadsRoot &&
    !absolute.startsWith(privateUploadsRoot + sep)
  ) {
    return null;
  }

  return absolute;
}
