import { Body, Controller, Get, Global, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ReservationDto, ReservationPatchDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { ReservationsService } from './reservations.service';

class ReservationBody extends createZodDto(ReservationDto) {}
class ReservationPatchBody extends createZodDto(ReservationPatchDto) {}
class ReservationListQuery extends createZodDto(z.object({ branchId: z.string().uuid(), from: z.string().date(), to: z.string().date(), status: z.string().max(20).optional() })) {}
class AvailQuery extends createZodDto(z.object({ branchId: z.string().uuid(), startsAt: z.string().datetime(), partySize: z.coerce.number().int().min(1).max(50), durationMin: z.coerce.number().int().min(15).max(480).default(90) })) {}
const id = new ParseUUIDPipe();

@ApiTags('reservations')
@Controller('reservations')
class ReservationsController {
  constructor(private readonly svc: ReservationsService) {}
  @Get() @Require('floor.reservation.read') list(@Query() q: ReservationListQuery) { return this.svc.list(q); }
  @Get('availability') @Require('floor.reservation.read') availability(@Query() q: AvailQuery) { return this.svc.availability(q.branchId, q.startsAt, q.partySize, q.durationMin); }
  @Post() @Require('floor.reservation.write') create(@Body() b: ReservationBody) { return this.svc.create(b); }
  @Patch(':id') @Require('floor.reservation.write') update(@Param('id', id) i: string, @Body() b: ReservationPatchBody) { return this.svc.update(i, b); }
  @Post(':id/confirm') @Require('floor.reservation.write') confirm(@Param('id', id) i: string) { return this.svc.setStatus(i, 'CONFIRMED'); }
  @Post(':id/arrive') @Require('floor.reservation.write') arrive(@Param('id', id) i: string) { return this.svc.setStatus(i, 'ARRIVED'); }
  @Post(':id/cancel') @Require('floor.reservation.write') cancel(@Param('id', id) i: string) { return this.svc.setStatus(i, 'CANCELLED'); }
  @Post(':id/no-show') @Require('floor.reservation.write') noShow(@Param('id', id) i: string) { return this.svc.setStatus(i, 'NO_SHOW'); }
}

@Global()
@Module({ controllers: [ReservationsController], providers: [ReservationsService], exports: [ReservationsService] })
export class ReservationsModule {}
