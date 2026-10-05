import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(__dirname, '../../../.env') });
if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is not set (see .env.example)');
// Everything in e2e runs against the isolated test database, never the dev one.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.NODE_ENV = 'test';
process.env.THROTTLE_LIMIT = '100000';
process.env.THROTTLE_AUTH_LIMIT = '100000';
