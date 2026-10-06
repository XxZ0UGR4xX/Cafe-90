import { Global, Module } from '@nestjs/common';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';

@Global()
@Module({ controllers: [FloorController], providers: [FloorService], exports: [FloorService] })
export class FloorModule {}
