import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Uniform error body: { statusCode, code, message, details?, traceId, path, timestamp }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message: string = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = HttpStatus[status] ?? 'ERROR';
      if (typeof body === 'string') message = body;
      else {
        const b = body as Record<string, any>;
        code = b.code ?? code;
        if (Array.isArray(b.message)) {
          message = 'Validation failed';
          details = b.message;
          code = 'VALIDATION_ERROR';
        } else message = b.message ?? exception.message;
        details = b.details ?? details;
      }
    } else if ((exception as Error)?.name === 'PrismaClientValidationError') {
      // e.g. `null` for a required column slipped past @IsOptional(): the client's fault, not ours. Details stay in the log.
      status = HttpStatus.BAD_REQUEST;
      code = 'INVALID_DATA';
      message = 'The request contains invalid or missing values';
      this.logger.warn(`Prisma validation (${req.method} ${req.url}): ${(exception as Error).message.split('\n').slice(-3).join(' ').slice(0, 300)}`);
    } else if (this.isPrismaError(exception)) {
      const e = exception as { code: string; meta?: Record<string, unknown> };
      if (e.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'UNIQUE_CONSTRAINT';
        message = 'A record with the same unique value already exists';
        details = { fields: e.meta?.target ?? e.meta?.driverAdapterError };
      } else if (e.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Record not found';
      } else if (e.code === 'P2011' || e.code === 'P2012') {
        status = HttpStatus.BAD_REQUEST;
        code = 'INVALID_DATA';
        message = 'A required value is missing';
      } else if (e.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'FOREIGN_KEY_VIOLATION';
        message = 'The record is referenced by, or references, another record';
      }
    }

    if (status >= 500) this.logger.error(`${req.method} ${req.url} -> ${status}`, (exception as Error)?.stack);

    res.status(status).json({
      statusCode: status,
      code,
      message,
      details,
      traceId: req.traceId,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  private isPrismaError(e: unknown) {
    return typeof e === 'object' && e !== null && typeof (e as any).code === 'string' && /^P\d{4}$/.test((e as any).code);
  }
}
