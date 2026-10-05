import { Body, Controller, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, Permissions, SkipAudit } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { MAX_UPLOAD_BYTES, MediaService } from './media.service';

@ApiTags('media') @ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post() @Permissions('media:upload') @SkipAudit()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Query('folder') folder = 'misc', @Body('alt') alt: string | undefined, @CurrentUser() u: AuthUser) {
    return this.media.upload(file, folder, alt, u.id);
  }
}
