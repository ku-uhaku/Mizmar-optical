import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DocumentsService } from './documents.service';

@Module({ imports: [SettingsModule], providers: [DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}
