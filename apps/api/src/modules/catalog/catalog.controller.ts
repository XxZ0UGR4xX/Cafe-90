import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BranchProductDto, CategoryDto, IngredientDto, ModifierGroupDto, ProductDto, RecipeItemDto, TaxDto } from '@retroburger/shared';
import { Require } from '../identity/access.decorators';
import { CatalogService } from './catalog.service';

class CategoryBody extends createZodDto(CategoryDto) {}
class TaxBody extends createZodDto(TaxDto) {}
class IngredientBody extends createZodDto(IngredientDto) {}
class ModifierGroupBody extends createZodDto(ModifierGroupDto) {}
class ProductBody extends createZodDto(ProductDto) {}
class RecipeBody extends createZodDto(z.object({ items: z.array(RecipeItemDto).max(60) })) {}
class BranchProductBody extends createZodDto(BranchProductDto) {}
class SearchQuery extends createZodDto(z.object({ q: z.string().max(80).optional() })) {}
class ProductQuery extends createZodDto(z.object({
  categoryId: z.string().uuid().optional(), q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) })) {}
class MenuQuery extends createZodDto(z.object({ branchId: z.string().uuid() })) {}

const uuidPipe = new ParseUUIDPipe();

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  @Get('menu') @Require('catalog.product.read') menu(@Query() q: MenuQuery) { return this.svc.menu(q.branchId); }

  @Get('categories') @Require('catalog.product.read') categories() { return this.svc.listCategories(); }
  @Post('categories') @Require('catalog.product.write') createCategory(@Body() b: CategoryBody) { return this.svc.saveCategory(null, b); }
  @Put('categories/:id') @Require('catalog.product.write')
  updateCategory(@Param('id', uuidPipe) id: string, @Body() b: CategoryBody) { return this.svc.saveCategory(id, b); }
  @Delete('categories/:id') @HttpCode(204) @Require('catalog.product.write')
  async deleteCategory(@Param('id', uuidPipe) id: string) { await this.svc.deleteCategory(id); }

  @Get('taxes') @Require('catalog.product.read') taxes() { return this.svc.listTaxes(); }
  @Post('taxes') @Require('catalog.product.write') createTax(@Body() b: TaxBody) { return this.svc.createTax(b); }

  @Get('ingredients') @Require('catalog.product.read') ingredients(@Query() q: SearchQuery) { return this.svc.listIngredients(q.q); }
  @Post('ingredients') @Require('catalog.recipe.write') createIngredient(@Body() b: IngredientBody) { return this.svc.saveIngredient(null, b); }
  @Put('ingredients/:id') @Require('catalog.recipe.write')
  updateIngredient(@Param('id', uuidPipe) id: string, @Body() b: IngredientBody) { return this.svc.saveIngredient(id, b); }
  @Delete('ingredients/:id') @HttpCode(204) @Require('catalog.recipe.write')
  async deleteIngredient(@Param('id', uuidPipe) id: string) { await this.svc.deleteIngredient(id); }

  @Get('modifier-groups') @Require('catalog.product.read') groups() { return this.svc.listModifierGroups(); }
  @Post('modifier-groups') @Require('catalog.product.write') createGroup(@Body() b: ModifierGroupBody) { return this.svc.saveModifierGroup(null, b); }
  @Put('modifier-groups/:id') @Require('catalog.product.write')
  updateGroup(@Param('id', uuidPipe) id: string, @Body() b: ModifierGroupBody) { return this.svc.saveModifierGroup(id, b); }
  @Delete('modifier-groups/:id') @HttpCode(204) @Require('catalog.product.write')
  async deleteGroup(@Param('id', uuidPipe) id: string) { await this.svc.deleteModifierGroup(id); }

  @Get('products') @Require('catalog.product.read') products(@Query() q: ProductQuery) { return this.svc.listProducts(q); }
  @Get('products/:id') @Require('catalog.product.read') product(@Param('id', uuidPipe) id: string) { return this.svc.getProduct(id); }
  @Post('products') @Require('catalog.product.write') createProduct(@Body() b: ProductBody) { return this.svc.saveProduct(null, b); }
  @Put('products/:id') @Require('catalog.product.write')
  updateProduct(@Param('id', uuidPipe) id: string, @Body() b: ProductBody) { return this.svc.saveProduct(id, b); }
  @Delete('products/:id') @HttpCode(204) @Require('catalog.product.write')
  async deleteProduct(@Param('id', uuidPipe) id: string) { await this.svc.deleteProduct(id); }
  @Put('products/:id/recipe') @Require('catalog.recipe.write')
  setRecipe(@Param('id', uuidPipe) id: string, @Body() b: RecipeBody) { return this.svc.setRecipe(id, b.items); }
  @Get('products/:id/cost') @Require('catalog.cost.read') cost(@Param('id', uuidPipe) id: string) { return this.svc.productCost(id); }

  @Put('branches/:branchId/products/:productId') @Require('catalog.product.write')
  branchProduct(@Param('branchId', uuidPipe) branchId: string, @Param('productId', uuidPipe) productId: string, @Body() b: BranchProductBody) {
    return this.svc.setBranchProduct(branchId, productId, b);
  }
}
