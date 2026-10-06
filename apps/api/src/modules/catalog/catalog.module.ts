import { Global, Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Global()
@Module({ controllers: [CatalogController], providers: [CatalogService, CatalogRepository], exports: [CatalogService, CatalogRepository] })
export class CatalogModule {}
