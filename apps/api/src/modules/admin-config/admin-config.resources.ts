import { BadRequestException, Injectable } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService, type CrudConfig } from '../../common/crud/simple-crud.service';
import { PrismaService } from '../../prisma/prisma.service';
import { renderHtml } from '../documents/template-engine';
import * as D from './admin-config.dto';
import { cleanTranslations, plainText, richText } from './sanitize';
import { sampleContext } from './sample-context';
import { ModuleToggleService } from './modules-toggle.service';

/** Templates and messages are rendered into documents and emails: refuse anything that could run code. */
export function assertNoActiveContent(html: string) {
  if (/<\s*(script|iframe|object|embed|link|meta\s+http-equiv)\b/i.test(html) || /\son\w+\s*=/i.test(html) || /javascript:|data:text\/html/i.test(html)) {
    throw new BadRequestException({ code: 'UNSAFE_MARKUP', message: 'Scripts, event handlers and embedded frames are not allowed in templates' });
  }
}

/** Keep exactly one default: setting a new one clears the others; the current default cannot be switched off or deleted. */
const oneDefault = (model: string, scope?: (d: Record<string, any>, existing: Record<string, any> | null) => Record<string, unknown>) =>
  async (data: Record<string, any>, existing: Record<string, any> | null, prisma: PrismaService) => {
    const raw = (prisma.raw as any)[model];
    const where = { ...(scope?.(data, existing) ?? {}), isDefault: true, deletedAt: null, ...(existing ? { id: { not: existing.id } } : {}) };
    if (data.isDefault === true) await raw.updateMany({ where, data: { isDefault: false } });
    if (existing?.isDefault && (data.isDefault === false || data.isActive === false)) throw new BadRequestException({ code: 'DEFAULT_REQUIRED', message: 'Pick another default first: there must always be one' });
    return data;
  };
const notDefault = (model: string, label: string) => async (p: PrismaService, id: string) => ((await (p.db as any)[model].count({ where: { id, isDefault: true } })) ? `The default ${label} cannot be deleted` : null);

const make = (cfg: CrudConfig) => {
  @Injectable()
  class S extends SimpleCrudService { constructor(prisma: PrismaService) { super(prisma, cfg); } }
  return S;
};

const translated = (d: Record<string, any>) => (d.translations !== undefined ? { ...d, translations: cleanTranslations(d.translations) ?? undefined } : d);
const SECRET_KEY = /secret|token|password|passwd|private|apikey|api_key|credential/i;

// ------------------------------------------------------------------ localization
export const LanguagesService = make({ model: 'language', label: 'Language', search: ['name', 'code'], sortable: ['sortOrder', 'name'], defaultSort: 'sortOrder', unique: ['code'], filters: ['isActive'], beforeSave: oneDefault('language'), inUse: notDefault('language', 'language') });
export const CurrenciesService = make({ model: 'currency', label: 'Currency', search: ['name', 'code'], sortable: ['name', 'code'], defaultSort: 'code', unique: ['code'], filters: ['isActive'], beforeSave: oneDefault('currency'), inUse: notDefault('currency', 'currency') });
export const TaxRatesService = make({
  model: 'taxRate', label: 'Tax rate', search: ['name', 'code'], sortable: ['name', 'rate'], defaultSort: 'name', unique: ['code'], filters: ['isActive'], beforeSave: oneDefault('taxRate'),
  inUse: async (p, id) => ((await (p.db as any).taxRate.count({ where: { id, isDefault: true } })) ? 'The default tax rate cannot be deleted' : (await p.db.orderLine.count({ where: { taxRateId: id } })) ? 'Sales used this rate: deactivate it instead' : null),
});
export const LanguagesController = createCrudController({ path: 'languages', tag: 'settings', module: 'config', service: LanguagesService, create: D.LanguageDto, update: D.UpdateLanguageDto });
export const CurrenciesController = createCrudController({ path: 'currencies', tag: 'settings', module: 'config', service: CurrenciesService, create: D.CurrencyDto, update: D.UpdateCurrencyDto });
export const TaxRatesController = createCrudController({ path: 'tax-rates', tag: 'settings', module: 'config', service: TaxRatesService, create: D.TaxRateDto, update: D.UpdateTaxRateDto });

// ------------------------------------------------------------------ messaging, payments, documents
export const EmailTemplatesService = make({ model: 'emailTemplate', label: 'Email template', search: ['code', 'subject'], sortable: ['code', 'locale'], defaultSort: 'code', filters: ['locale', 'isActive'], beforeSave: (d) => { if (d.body) assertNoActiveContent(d.body); if (d.subject) d.subject = plainText(d.subject); return d; } });
export const SmsTemplatesService = make({ model: 'smsTemplate', label: 'SMS template', search: ['code', 'body'], sortable: ['code', 'locale'], defaultSort: 'code', filters: ['locale', 'isActive'] });
export const PaymentMethodsService = make({
  model: 'paymentMethodConfig', label: 'Payment method', search: ['name', 'code'], sortable: ['sortOrder', 'name'], defaultSort: 'sortOrder', unique: ['code'], filters: ['isActive', 'type'],
  beforeSave: (d) => {
    for (const k of Object.keys(d.config ?? {})) if (SECRET_KEY.test(k)) throw new BadRequestException({ code: 'SECRET_IN_CONFIG', message: `"${k}" looks like a secret: keep secrets in environment variables, not in the database` });
    return translated(d);
  },
  inUse: async (p, id) => ((await p.db.payment.count({ where: { methodId: id } })) ? 'Payments used this method: deactivate it instead' : null),
});
export const DocumentTemplatesService = make({
  model: 'documentTemplate', label: 'Document template', search: ['name'], sortable: ['name', 'type', 'createdAt'], defaultSort: 'type', filters: ['type'],
  beforeSave: async (d, existing, prisma) => {
    if (d.html !== undefined) {
      assertNoActiveContent(d.html);
      try { renderHtml(d.html, sampleContext(d.type ?? existing?.type, 'fr')); } catch (e) { throw new BadRequestException({ code: 'TEMPLATE_ERROR', message: `The template does not render: ${(e as Error).message}` }); }
    }
    if (d.isDefault === true) await prisma.raw.documentTemplate.updateMany({ where: { type: d.type ?? existing?.type, storeId: d.storeId ?? existing?.storeId ?? null, isDefault: true, deletedAt: null, ...(existing ? { id: { not: existing.id } } : {}) }, data: { isDefault: false } });
    return d;
  },
});
export const EmailTemplatesController = createCrudController({ path: 'email-templates', tag: 'settings', module: 'config', service: EmailTemplatesService, create: D.EmailTemplateDto, update: D.UpdateEmailTemplateDto });
export const SmsTemplatesController = createCrudController({ path: 'sms-templates', tag: 'settings', module: 'config', service: SmsTemplatesService, create: D.SmsTemplateDto, update: D.UpdateSmsTemplateDto });
export const PaymentMethodsController = createCrudController({ path: 'payment-method-settings', tag: 'settings', module: 'config', service: PaymentMethodsService, create: D.PaymentMethodDto, update: D.UpdatePaymentMethodDto });
export const DocumentTemplatesController = createCrudController({ path: 'document-templates', tag: 'settings', module: 'config', service: DocumentTemplatesService, create: D.DocumentTemplateDto, update: D.UpdateDocumentTemplateDto });

// ------------------------------------------------------------------ website content
const publish = (d: Record<string, any>, existing: Record<string, any> | null) => {
  if (d.status === 'PUBLISHED' && !d.publishedAt && !existing?.publishedAt) d.publishedAt = new Date();
  return d;
};
export const BannersService = make({ model: 'banner', label: 'Banner', search: ['title'], sortable: ['sortOrder', 'createdAt'], defaultSort: 'sortOrder', filters: ['placement', 'isActive'], beforeSave: (d) => translated({ ...d, ...(d.title !== undefined && { title: plainText(d.title) }), ...(d.subtitle !== undefined && { subtitle: plainText(d.subtitle) }) }) });
export const TestimonialsService = make({ model: 'testimonial', label: 'Testimonial', search: ['authorName', 'content'], sortable: ['sortOrder', 'createdAt'], defaultSort: 'sortOrder', filters: ['isActive'], beforeSave: (d) => translated({ ...d, ...(d.content !== undefined && { content: plainText(d.content) }), ...(d.authorName !== undefined && { authorName: plainText(d.authorName) }) }) });
export const CmsPagesService = make({ model: 'cmsPage', label: 'Page', search: ['title', 'slug'], sortable: ['title', 'updatedAt'], defaultSort: 'updatedAt', unique: ['slug'], slugFrom: 'title', filters: ['status'], beforeSave: (d, existing) => publish(translated({ ...d, ...(d.content !== undefined && { content: richText(d.content) }) }), existing) });
export const BlogCategoriesService = make({ model: 'blogCategory', label: 'Blog category', search: ['name'], sortable: ['name'], defaultSort: 'name', unique: ['slug'], slugFrom: 'name', beforeSave: translated, inUse: async (p, id) => ((await p.db.blogPost.count({ where: { categoryId: id } })) ? 'Posts use this category' : null) });
export const BlogPostsService = make({ model: 'blogPost', label: 'Post', search: ['title', 'slug'], sortable: ['title', 'publishedAt', 'updatedAt'], defaultSort: 'updatedAt', unique: ['slug'], slugFrom: 'title', filters: ['status', 'categoryId'], include: { category: { select: { id: true, name: true } } }, beforeSave: (d, existing) => publish(translated({ ...d, ...(d.content !== undefined && { content: richText(d.content) }) }), existing) });
const SECTION_LIMIT = 24;
export const HomeSectionsService = make({
  model: 'homeSection', label: 'Home section', search: ['title'], sortable: ['sortOrder'], defaultSort: 'sortOrder', filters: ['type', 'isActive'],
  beforeSave: (d) => {
    if (d.config) {
      const c = { ...d.config } as Record<string, unknown>;
      if (c.limit !== undefined && !(Number.isInteger(c.limit) && (c.limit as number) >= 1 && (c.limit as number) <= SECTION_LIMIT)) throw new BadRequestException({ code: 'INVALID_CONFIG', message: `limit must be a whole number from 1 to ${SECTION_LIMIT}` });
      if (c.couponCode !== undefined && !/^[A-Z0-9_-]{3,30}$/.test(String(c.couponCode))) throw new BadRequestException({ code: 'INVALID_CONFIG', message: 'couponCode must look like WELCOME10' });
      if (typeof c.html === 'string') c.html = richText(c.html);
      d.config = c;
    }
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) throw new BadRequestException({ code: 'INVALID_RANGE', message: 'The end must be after the start' });
    return translated({ ...d, ...(d.title !== undefined && { title: plainText(d.title) }), ...(d.subtitle !== undefined && { subtitle: plainText(d.subtitle) }) });
  },
});
export const BannersController = createCrudController({ path: 'banners', tag: 'content', module: 'cms', service: BannersService, create: D.BannerDto, update: D.UpdateBannerDto });
export const TestimonialsController = createCrudController({ path: 'testimonials', tag: 'content', module: 'cms', service: TestimonialsService, create: D.TestimonialDto, update: D.UpdateTestimonialDto });
export const CmsPagesController = createCrudController({ path: 'cms-pages', tag: 'content', module: 'cms', service: CmsPagesService, create: D.CmsPageDto, update: D.UpdateCmsPageDto });
export const BlogCategoriesController = createCrudController({ path: 'blog-categories', tag: 'content', module: 'cms', service: BlogCategoriesService, create: D.BlogCategoryDto, update: D.UpdateBlogCategoryDto });
export const BlogPostsController = createCrudController({ path: 'blog-posts', tag: 'content', module: 'cms', service: BlogPostsService, create: D.BlogPostDto, update: D.UpdateBlogPostDto });
export const HomeSectionsController = createCrudController({ path: 'home-sections', tag: 'content', module: 'cms', service: HomeSectionsService, create: D.HomeSectionDto, update: D.UpdateHomeSectionDto });

// ------------------------------------------------------------------ custom field definitions
export const CustomFieldsDefService = make({
  model: 'customFieldDefinition', label: 'Custom field', search: ['label', 'key'], sortable: ['sortOrder', 'label'], defaultSort: 'sortOrder', filters: ['entity', 'isActive'],
  beforeSave: (d, existing) => {
    const type = d.type ?? existing?.type;
    if (['SELECT', 'MULTI_SELECT'].includes(type) && !(d.options ?? existing?.options)?.length) throw new BadRequestException({ code: 'OPTIONS_REQUIRED', message: 'List the choices for this field' });
    if (existing && (d.entity && d.entity !== existing.entity || d.key && d.key !== existing.key || d.type && d.type !== existing.type)) throw new BadRequestException({ code: 'FIELD_LOCKED', message: 'The entity, key and type of a field cannot change once it exists: create a new one' });
    return translated(d);
  },
  inUse: async (p, id) => ((await p.db.customFieldValue.count({ where: { definitionId: id } })) ? 'Records have values for this field: deactivate it instead' : null),
});
export const CustomFieldsController = createCrudController({ path: 'custom-field-definitions', tag: 'settings', module: 'config', service: CustomFieldsDefService, create: D.CustomFieldDto, update: D.UpdateCustomFieldDto });
void ModuleToggleService;
