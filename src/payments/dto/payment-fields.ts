import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_DEBT_AMOUNT } from 'src/debts/dto/create-debt.dto';

export const NOTE_MAX_LENGTH = 200;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** Monto de un movimiento: mayor que cero, dos decimales y con tope. */
export const IsMoneyAmount = () =>
  applyDecorators(
    IsNumber(
      { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
      { message: 'El monto debe ser un número con máximo dos decimales' },
    ),
    IsPositive({ message: 'El monto debe ser mayor a cero' }),
    Max(MAX_DEBT_AMOUNT, { message: 'El monto es demasiado grande' }),
  );

/** Nota opcional: se recorta y vacía queda nula. */
export const IsOptionalNote = () =>
  applyDecorators(
    IsOptional(),
    IsString(),
    trim,
    MaxLength(NOTE_MAX_LENGTH, {
      message: `La nota admite máximo ${NOTE_MAX_LENGTH} caracteres`,
    }),
  );

/** Motivo obligatorio: queda en el historial y en la auditoría. */
export const IsReason = () =>
  applyDecorators(
    IsString({ message: 'El motivo es obligatorio' }),
    trim,
    MinLength(3, { message: 'Escribe el motivo (mínimo 3 caracteres)' }),
    MaxLength(NOTE_MAX_LENGTH, {
      message: `El motivo admite máximo ${NOTE_MAX_LENGTH} caracteres`,
    }),
  );
