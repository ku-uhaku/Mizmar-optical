import { Module } from '@nestjs/common';
import { AdminConfigController } from './admin-config.controller';
import * as R from './admin-config.resources';
import { AdminConfigService } from './admin-config.service';
import { ModuleToggleModule } from './modules-toggle.service';

const services = [R.LanguagesService, R.CurrenciesService, R.TaxRatesService, R.EmailTemplatesService, R.SmsTemplatesService, R.PaymentMethodsService, R.DocumentTemplatesService, R.BannersService, R.TestimonialsService, R.CmsPagesService, R.BlogCategoriesService, R.BlogPostsService, R.HomeSectionsService, R.CustomFieldsDefService];
const controllers = [R.LanguagesController, R.CurrenciesController, R.TaxRatesController, R.EmailTemplatesController, R.SmsTemplatesController, R.PaymentMethodsController, R.DocumentTemplatesController, R.BannersController, R.TestimonialsController, R.CmsPagesController, R.BlogCategoriesController, R.BlogPostsController, R.HomeSectionsController, R.CustomFieldsController];

@Module({ imports: [ModuleToggleModule], controllers: [AdminConfigController, ...controllers], providers: [AdminConfigService, ...services] })
export class AdminConfigModule {}
