import { Body, CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OrderItemInputDto, ReservationDto } from '@retroburger/shared';
import { ENV, type Env } from '../../config/env';
import { AppError } from '../../common/errors';
import { RateLimiter } from '../../common/rate-limiter';
import { Public } from '../identity/access.decorators';
import { PublicService } from './public.service';

const uuid = z.string().uuid();
class PublicOrderBody extends createZodDto(z.object({
  branchId: uuid, type: z.enum(['PICKUP', 'DELIVERY']),
  customer: z.object({ name: z.string().min(1).max(120), phone: z.string().min(7).max(20), email: z.string().email().optional() }),
  address: z.string().min(5).max(300).optional(), addressNotes: z.string().max(200).optional(), notes: z.string().max(300).optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER']).optional(), couponCode: z.string().min(3).max(30).optional(),
  items: z.array(OrderItemInputDto).min(1).max(50),
})) {}
class QrOrderBody extends createZodDto(z.object({ customerName: z.string().max(120).optional(), notes: z.string().max(300).optional(), items: z.array(OrderItemInputDto).min(1).max(30) })) {}
class PublicReservationBody extends createZodDto(ReservationDto.omit({ customerId: true, tableId: true }).extend({ phone: z.string().min(7).max(20) })) {}
class MenuQuery extends createZodDto(z.object({ branchId: uuid })) {}
class AvailQuery extends createZodDto(z.object({ branchId: uuid, startsAt: z.string().datetime(), partySize: z.coerce.number().int().min(1).max(50), durationMin: z.coerce.number().int().min(15).max(480).default(90) })) {}
class LoyaltyQuery extends createZodDto(z.object({ phone: z.string().min(7).max(20), email: z.string().email() })) {}

/** Entra al tenant (por slug) y limita la tasa de peticiones públicas por IP. */
@Injectable()
class PublicGuard implements CanActivate {
  private readonly limiter: RateLimiter;
  constructor(private readonly svc: PublicService, @Inject(ENV) env: Env) { this.limiter = new RateLimiter(env.PUBLIC_RATE_LIMIT_MAX, 60_000); }
  async canActivate(c: ExecutionContext) {
    const req = c.switchToHttp().getRequest<FastifyRequest>();
    const writes = req.method !== 'GET';
    if (writes && this.limiter.hit(`${req.ip}`)) throw new AppError('RATE_LIMITED', 429, undefined, true);
    await this.svc.enter((req.params as { slug: string }).slug);
    return true;
  }
}

@ApiTags('public')
@Public()
@UseGuards(PublicGuard)
@Controller('public/:slug')
class PublicController {
  constructor(private readonly svc: PublicService) {}
  @Get() info() { return this.svc.info(); }
  @Get('menu') menu(@Query() q: MenuQuery) { return this.svc.menu(q.branchId); }
  @Post('orders') order(@Body() b: PublicOrderBody) { return this.svc.createOrder(b); }
  @Get('orders/:id') status(@Param('id') id: string) { return this.svc.orderStatus(z.string().uuid().parse(id)); }
  @Get('reservations/availability') availability(@Query() q: AvailQuery) { return this.svc.availability(q); }
  @Post('reservations') reservation(@Body() b: PublicReservationBody) { return this.svc.createReservation(b); }
  @Get('loyalty') loyalty(@Query() q: LoyaltyQuery) { return this.svc.loyalty(q.phone, q.email); }
  @Get('tables/:token') table(@Param('token') t: string) { return this.svc.qrTable(t); }
  @Get('tables/:token/bill') bill(@Param('token') t: string) { return this.svc.qrBill(t); }
  @Post('tables/:token/orders') qrOrder(@Param('token') t: string, @Body() b: QrOrderBody) { return this.svc.qrOrder(t, b); }
  @Post('tables/:token/call-waiter') call(@Param('token') t: string) { return this.svc.qrCall(t, 'WAITER'); }
  @Post('tables/:token/request-bill') requestBill(@Param('token') t: string) { return this.svc.qrCall(t, 'BILL'); }
}

@Module({ controllers: [PublicController], providers: [PublicService, PublicGuard] })
export class PublicModule {}
