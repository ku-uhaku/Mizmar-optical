import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SessionsService } from './sessions.service';

@Module({ imports: [SettingsModule], controllers: [PosController], providers: [PosService, SessionsService], exports: [SessionsService] })
export class PosModule {}
