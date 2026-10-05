import { defineRouting } from 'next-intl/routing';
import { LOCALES, DEFAULT_LOCALE } from '@mizmar/shared';

export const routing = defineRouting({ locales: [...LOCALES], defaultLocale: DEFAULT_LOCALE, localePrefix: 'always' });
