import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('Storage');
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.publicBase = (config.get('S3_PUBLIC_URL', { infer: true }) ?? `${endpoint}/${this.bucket}`).replace(/\/$/, '');
    this.s3 = new S3Client({
      endpoint,
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: { accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }), secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }) },
    });
  }

  /** Create the bucket (and make objects publicly readable for product media) when missing. */
  async onModuleInit() {
    try {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket "${this.bucket}"`);
      }
      await this.s3
        .send(new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${this.bucket}/*`] }] }),
        }))
        .catch((e) => this.logger.warn(`Could not set public-read policy: ${e.message}`));
    } catch (e) {
      this.logger.warn(`Object storage unavailable (${(e as Error).message}); uploads will fail until it is reachable`);
    }
  }

  publicUrl(key: string) {
    return `${this.publicBase}/${key}`;
  }

  buildKey(folder: string, fileName: string) {
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';
    return `${folder.replace(/^\/|\/$/g, '')}/${randomUUID()}${ext}`;
  }

  /** Presigned PUT so the browser uploads straight to object storage. */
  async presignUpload(key: string, contentType: string, expiresIn = 300) {
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn });
    return { uploadUrl: url, key, publicUrl: this.publicUrl(key) };
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return this.publicUrl(key);
  }

  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
