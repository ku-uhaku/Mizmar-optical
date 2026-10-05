import { Module } from '@nestjs/common';
import { ArrayUnique, IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { createCrudController } from '../../common/crud/crud.controller';
import * as D from './catalog.dto';
import * as S from './catalog.services';

class CreateLensTypeWithTreatmentsDto extends D.CreateLensTypeDto {
  @ApiPropertyOptional({ type: [String], description: 'Treatment ids offered with this lens type (replaces the set)' })
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) treatmentIds?: string[];
}
class UpdateLensTypeWithTreatmentsDto extends D.UpdateLensTypeDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) treatmentIds?: string[];
}

const c = (path: string, tag: string, service: any, create: any, update: any) => createCrudController({ path, tag, module: 'catalog', service, create, update });

@Module({
  controllers: [
    c('brands', 'catalog', S.BrandsService, D.CreateBrandDto, D.UpdateBrandDto),
    c('categories', 'catalog', S.CategoriesService, D.CreateCategoryDto, D.UpdateCategoryDto),
    c('frame-shapes', 'catalog', S.FrameShapesService, D.CreateFrameShapeDto, D.UpdateFrameShapeDto),
    c('frame-materials', 'catalog', S.FrameMaterialsService, D.CreateFrameMaterialDto, D.UpdateFrameMaterialDto),
    c('lens-types', 'catalog', S.LensTypesService, CreateLensTypeWithTreatmentsDto, UpdateLensTypeWithTreatmentsDto),
    c('lens-treatments', 'catalog', S.LensTreatmentsService, D.CreateLensTreatmentDto, D.UpdateLensTreatmentDto),
    c('lens-entries', 'catalog', S.LensEntriesService, D.CreateLensEntryDto, D.UpdateLensEntryDto),
  ],
  providers: [S.BrandsService, S.CategoriesService, S.FrameShapesService, S.FrameMaterialsService, S.LensTypesService, S.LensTreatmentsService, S.LensEntriesService],
  exports: [S.LensTypesService],
})
export class CatalogModule {}
