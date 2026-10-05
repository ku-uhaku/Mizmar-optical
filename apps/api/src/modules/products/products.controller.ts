import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { AddImageDto, LookupQueryDto, CreateProductDto, CreateVariantDto, ListProductsDto, ReorderImagesDto, UpdateProductDto, UpdateVariantDto } from './products.dto';
import { ProductsService } from './products.service';

@ApiTags('products') @ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get() @Permissions('products:read')
  list(@Query() q: ListProductsDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.products.list(q, u, s); }

  /** Barcode scanner / SKU entry. Declared before ':id' so "lookup" is not read as an id. */
  @Get('lookup/:code') @Permissions('products:read')
  lookup(@Param('code') code: string, @Query() q: LookupQueryDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.products.lookup(code, u, s, q.includeInactive === true); }

  @Get(':id') @Permissions('products:read')
  get(@Param('id') id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.products.get(id, u, s); }

  @Post() @Permissions('products:create')
  create(@Body() dto: CreateProductDto, @CurrentUser() u: AuthUser) { return this.products.create(dto, u); }

  @Patch(':id') @Permissions('products:update')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() u: AuthUser) { return this.products.update(id, dto, u); }

  @Delete(':id') @HttpCode(204) @Permissions('products:delete')
  remove(@Param('id') id: string) { return this.products.remove(id); }

  // variants
  @Post(':id/variants') @Permissions('products:update')
  addVariant(@Param('id') id: string, @Body() dto: CreateVariantDto, @CurrentUser() u: AuthUser) { return this.products.addVariant(id, dto, u); }

  @Patch('variants/:variantId') @Permissions('products:update')
  updateVariant(@Param('variantId') id: string, @Body() dto: UpdateVariantDto) { return this.products.updateVariant(id, dto); }

  @Delete('variants/:variantId') @HttpCode(204) @Permissions('products:update')
  removeVariant(@Param('variantId') id: string) { return this.products.removeVariant(id); }

  // images
  @Post(':id/images') @Permissions('products:update')
  addImage(@Param('id') id: string, @Body() dto: AddImageDto) { return this.products.addImage(id, dto); }

  @Put(':id/images/order') @HttpCode(204) @Permissions('products:update')
  reorder(@Param('id') id: string, @Body() dto: ReorderImagesDto) { return this.products.reorderImages(id, dto.ids); }

  @Post('images/:imageId/primary') @HttpCode(204) @Permissions('products:update')
  primary(@Param('imageId') id: string) { return this.products.setPrimaryImage(id); }

  @Delete('images/:imageId') @HttpCode(204) @Permissions('products:update')
  removeImage(@Param('imageId') id: string) { return this.products.removeImage(id); }
}
