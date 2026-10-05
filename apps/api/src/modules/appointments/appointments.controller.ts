import { Body, Controller, Delete, Get, HttpCode, Injectable, OnModuleInit, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { AllowCustomer, CurrentUser, CustomerOnly, OptionalAuth, Permissions, Public, RequiresModule } from '../../common/decorators';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsService } from './appointments.service';
import * as D from './appointments.dto';

@Injectable()
export class AppointmentTypesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: 'appointmentType', label: 'Appointment type', search: ['name', 'code'], sortable: ['name', 'durationMin', 'createdAt'], defaultSort: 'name', unique: ['code'], filters: ['isActive'],
      inUse: async (p, id) => ((await p.db.appointment.count({ where: { typeId: id } })) ? 'Appointments use this type: deactivate it instead' : null),
    });
  }
}
export const AppointmentTypesController = createCrudController({ path: 'appointment-types', tag: 'appointments', module: 'appointments', service: AppointmentTypesService, create: D.CreateAppointmentTypeDto, update: D.UpdateAppointmentTypeDto });

/** Public booking: nothing here needs an account (a signed-in customer is recognised when a token is sent). */
@ApiTags('appointments') @Public() @RequiresModule('appointments')
@Controller('public/appointments')
export class PublicAppointmentsController {
  constructor(private readonly svc: AppointmentsService, private readonly prisma: PrismaService) {}

  @Get('types') types() { return this.prisma.db.appointmentType.findMany({ where: { isActive: true, bookableOnline: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, description: true, durationMin: true, price: true, translations: true } }); }
  @Get('practitioners') practitioners(@Query() q: D.PractitionersQueryDto) { return this.svc.practitioners(q.storeId); }
  @Get('slots') slots(@Query() q: D.SlotsQueryDto) { return this.svc.slots(q, { publicOnly: true }); }

  @OptionalAuth() @AllowCustomer() @Post() @HttpCode(201)
  book(@Body() dto: D.BookDto, @CurrentUser() u?: AuthUser) { return this.svc.book(dto, u ?? null); }

  @Post('lookup') @HttpCode(200) lookup(@Body() dto: D.LookupDto) { return this.svc.lookup(dto); }
  @Post('cancel') @HttpCode(200) cancel(@Body() dto: D.LookupDto) { return this.svc.cancelByContact(dto); }
}

@ApiTags('account') @ApiBearerAuth() @CustomerOnly() @RequiresModule('appointments')
@Controller('account/appointments')
export class AccountAppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}
  @Get() mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u); }
  @Post(':number/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.cancelMine(u, n); }
}

@ApiTags('appointments') @ApiBearerAuth()
@Controller()
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get('appointments') @Permissions('appointments:read') list(@Query() q: D.ListAppointmentsDto, @CurrentUser() u: AuthUser) { return this.svc.list(q, u); }
  @Get('appointments/calendar') @Permissions('appointments:read') calendar(@Query() q: D.CalendarQueryDto, @CurrentUser() u: AuthUser) { return this.svc.calendar(q, u); }
  @Get('appointments/slots') @Permissions('appointments:read') slots(@Query() q: D.SlotsQueryDto) { return this.svc.slots(q, { publicOnly: false }); }
  @Get('appointments/staff') @Permissions('appointments:read') staff(@Query() q: D.PractitionersQueryDto, @CurrentUser() u: AuthUser) { return this.svc.staffForStore(q.storeId, u); }
  @Post('appointments') @Permissions('appointments:create') book(@Body() dto: D.StaffBookDto, @CurrentUser() u: AuthUser) { return this.svc.staffBook(dto, u); }
  @Get('appointments/:id') @Permissions('appointments:read') get(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.get(id, u); }
  @Patch('appointments/:id') @Permissions('appointments:update') update(@Param('id') id: string, @Body() dto: D.UpdateAppointmentDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u); }
  @Post('appointments/:id/status') @HttpCode(200) @Permissions('appointments:update') status(@Param('id') id: string, @Body() dto: D.AppointmentStatusDto, @CurrentUser() u: AuthUser) { return this.svc.status(id, dto, u); }

  @Get('practitioners/:id/availability') @Permissions('appointments:read') availability(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.availability(id, u); }
  @Put('practitioners/:id/availability') @Permissions('appointments:update') setAvailability(@Param('id') id: string, @Body() dto: D.SetAvailabilityDto, @CurrentUser() u: AuthUser) { return this.svc.setAvailability(id, dto, u); }
  @Get('practitioners/:id/time-off') @Permissions('appointments:read') timeOff(@Param('id') id: string) { return this.svc.timeOff(id); }
  @Post('practitioners/:id/time-off') @Permissions('appointments:update') addTimeOff(@Param('id') id: string, @Body() dto: D.TimeOffDto) { return this.svc.addTimeOff(id, dto); }
  @Delete('time-off/:id') @HttpCode(204) @Permissions('appointments:update') removeTimeOff(@Param('id') id: string) { return this.svc.removeTimeOff(id); }
}

/** Hourly sweep that sends the 24-hour reminder emails. Registered as a repeatable job so it survives restarts and runs once cluster-wide. */
@Processor('reminders')
export class RemindersProcessor extends WorkerHost {
  constructor(private readonly svc: AppointmentsService) { super(); }
  process() { return this.svc.sendReminders(); }
}

@Injectable()
export class RemindersScheduler implements OnModuleInit {
  constructor(@InjectQueue('reminders') private readonly queue: Queue) {}
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return; // tests call sendReminders() directly; a shared Redis must not run it against two databases
    await this.queue.upsertJobScheduler('appointment-reminders', { every: 3_600_000 }, { name: 'sweep' });
  }
}
