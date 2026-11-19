import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AccountLifecycleService } from './account-lifecycle/account-lifecycle.service';

/**
 * Ejecuta a mano el mantenimiento diario de cuentas (el mismo que corre
 * automáticamente a las 3:00 a. m.). Sirve para probarlo o para recuperarlo
 * si el servidor estuvo caído a esa hora.
 *
 *   npm run build && npm run maintenance:run:local
 */
async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(AccountLifecycleService).runMaintenance();
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
