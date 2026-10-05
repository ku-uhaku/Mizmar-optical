import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const FOLDERS = ['products', 'brands', 'categories', 'prescriptions', 'cms', 'misc'] as const;

/** Magic-number sniffing: never trust the client-supplied Content-Type. */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'image/gif', ext: '.gif', test: (b) => b.subarray(0, 4).toString() === 'GIF8' },
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
];

@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService, private readonly prisma: PrismaService) {}

  async upload(file: Express.Multer.File | undefined, folder: string, alt: string | undefined, actorId: string) {
    if (!file) throw new BadRequestException('No file uploaded (multipart field "file")');
    if (!(FOLDERS as readonly string[]).includes(folder)) throw new BadRequestException(`folder must be one of: ${FOLDERS.join(', ')}`);
    if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('File is larger than 5 MB');
    const sig = SIGNATURES.find((s) => s.test(file.buffer));
    if (!sig) throw new BadRequestException('Unsupported or corrupt file. Allowed: PNG, JPEG, WebP, GIF, PDF');
    if (sig.mime === 'application/pdf' && folder !== 'prescriptions') throw new BadRequestException('PDF files are only accepted in the prescriptions folder');
    const key = this.storage.buildKey(folder, `file${sig.ext}`); // original filename is NOT used in the key
    const url = await this.storage.put(key, file.buffer, sig.mime);
    return this.prisma.raw.mediaAsset.create({
      data: { key, url, fileName: file.originalname?.slice(0, 200), mimeType: sig.mime, sizeBytes: file.size, folder, alt, uploadedById: actorId },
    });
  }
}
