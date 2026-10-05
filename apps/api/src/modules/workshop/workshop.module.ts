import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SettingsModule } from '../settings/settings.module';
import { WorkshopController } from './workshop.controller';
import { WorkshopService } from './workshop.service';

@Module({ imports: [DocumentsModule, SettingsModule], controllers: [WorkshopController], providers: [WorkshopService], exports: [WorkshopService] })
export class WorkshopModule {}
