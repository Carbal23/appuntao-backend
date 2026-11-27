import { DynamicModule, Module } from '@nestjs/common';

/**
 * Reemplazo de `@nestjs/schedule` en las pruebas con base real.
 *
 * Desde la versión 12 el paquete es solo ESM y Jest (con Node 22) no lo
 * puede cargar con `require`. La aplicación lo carga sin problema. En las
 * pruebas tampoco debe correr la tarea diaria, así que basta con que `@Cron`
 * no haga nada y `ScheduleModule.forRoot()` sea un módulo vacío.
 * `jest-db.json` lo conecta con `moduleNameMapper`.
 */
export const Cron = (): MethodDecorator => () => undefined;

@Module({})
export class ScheduleModule {
  static forRoot(): DynamicModule {
    return { module: ScheduleModule };
  }
}
