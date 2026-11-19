import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccountLifecycleService } from './account-lifecycle.service';

@Injectable()
export class AccountMaintenanceService {
  constructor(private readonly accountLifecycle: AccountLifecycleService) {}

  // Todos los días a las 3:00 a. m., hora de Colombia. La anonimización es
  // idempotente: si corren varias instancias a la vez, una cuenta solo se
  // anonimiza una vez.
  @Cron('0 3 * * *', {
    name: 'account-maintenance',
    timeZone: 'America/Bogota',
  })
  async handleDailyMaintenance() {
    await this.accountLifecycle.runMaintenance();
  }
}
