import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { AccountAppointmentsController, AppointmentTypesController, AppointmentTypesService, AppointmentsController, PublicAppointmentsController, RemindersProcessor, RemindersScheduler } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [SettingsModule, BullModule.registerQueue({ name: 'reminders' })],
  controllers: [AppointmentTypesController, AppointmentsController, PublicAppointmentsController, AccountAppointmentsController],
  providers: [AppointmentsService, AppointmentTypesService, RemindersProcessor, RemindersScheduler],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
