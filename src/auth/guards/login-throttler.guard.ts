import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthLogEvent } from '@prisma/client';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { requestContextFrom } from 'src/common/decorators/request-context.decorator';
import { normalizeLoginIdentifier } from 'src/common/validation/user-identifier';

type LoginBody =
  | { identifier?: unknown; deviceId?: unknown; deviceName?: unknown }
  | undefined;

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  private readonly loggedBlocks = new Map<string, number>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly authLog: AuthLogService,
  ) {
    super(options, storageService, reflector);
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    const body = req.body as LoginBody;
    // Normalizado: si no, cada forma de escribir el mismo dato tendría su
    // propio contador y el límite se esquivaría con espacios o con +57.
    const identifier =
      typeof body?.identifier === 'string'
        ? normalizeLoginIdentifier(body.identifier)
        : '';
    const ip = req.ip as string | undefined;

    return Promise.resolve(`${ip ?? 'unknown'}:${identifier}`);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const now = Date.now();
    for (const [key, blockEndsAt] of this.loggedBlocks) {
      if (blockEndsAt <= now) this.loggedBlocks.delete(key);
    }

    if (!this.loggedBlocks.has(detail.key)) {
      this.loggedBlocks.set(detail.key, now + detail.timeToBlockExpire * 1000);

      const request = context.switchToHttp().getRequest<Request>();
      const body = request.body as LoginBody;

      await this.authLog.record({
        event: AuthLogEvent.LOGIN_BLOCKED,
        identifier:
          typeof body?.identifier === 'string' ? body.identifier : undefined,
        deviceId:
          typeof body?.deviceId === 'string' ? body.deviceId : undefined,
        deviceName:
          typeof body?.deviceName === 'string' ? body.deviceName : undefined,
        context: requestContextFrom(request),
      });
    }

    return super.throwThrottlingException(context, detail);
  }
}
