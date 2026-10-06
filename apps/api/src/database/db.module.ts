import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { ENV, loadEnv } from '../config/env';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, DbService],
  exports: [DbService, ENV],
})
export class DbModule {}
