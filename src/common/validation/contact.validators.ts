import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  isEmail,
  Matches,
  MaxLength,
  MinLength,
  ValidateBy,
  ValidationArguments,
} from 'class-validator';

/**
 * Normalización y validación de datos de contacto e identidad.
 *
 * Los datos se guardan en un formato único para que el mismo correo o
 * teléfono no quede registrado dos veces con distinta escritura, y para que el
 * login y las búsquedas los encuentren se escriban como se escriban.
 */

/** Celular (3XXXXXXXXX) o fijo (60XXXXXXXX) de Colombia: 10 dígitos. */
export const COLOMBIA_PHONE_PATTERN = /^(3\d{9}|60\d{8})$/;

export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** Deja solo los dígitos y quita el indicativo 57: "+57 300 123 4567" → "3001234567". */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('57')
    ? digits.slice(2)
    : digits;
}

/**
 * Cédula y NIT se guardan solo con dígitos ("1.032.876.361" → "1032876361";
 * el NIT con su dígito de verificación, sin guion). El documento de
 * extranjería se guarda en mayúsculas, sin espacios ni separadores.
 */
export function normalizeDocumentNumber(
  value: unknown,
  documentType?: unknown,
): unknown {
  if (typeof value !== 'string') return value;
  if (documentType === 'CC' || documentType === 'NIT') {
    return value.replace(/\D/g, '');
  }
  return value.replace(/[\s.-]/g, '').toUpperCase();
}

const DOCUMENT_PATTERNS: Record<string, { pattern: RegExp; message: string }> =
  {
    CC: {
      pattern: /^\d{6,10}$/,
      message: 'La cédula debe tener entre 6 y 10 dígitos',
    },
    NIT: {
      pattern: /^\d{9,10}$/,
      message:
        'El NIT debe tener 9 dígitos, o 10 con el dígito de verificación',
    },
    FOREIGNER: {
      pattern: /^[A-Z0-9]{3,20}$/,
      message:
        'El documento de extranjería debe tener entre 3 y 20 letras o números',
    },
  };

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export function IsNormalizedEmail() {
  return applyDecorators(
    Transform(({ value }) => normalizeEmail(value)),
    IsEmail({}, { message: 'El correo electrónico no es válido' }),
    MaxLength(254, {
      message: 'El correo electrónico no puede tener más de 254 caracteres',
    }),
  );
}

export function IsColombianPhone() {
  return applyDecorators(
    Transform(({ value }) => normalizePhone(value)),
    Matches(COLOMBIA_PHONE_PATTERN, {
      message:
        'El teléfono debe ser un celular colombiano de 10 dígitos (3XXXXXXXXX) o un fijo (60XXXXXXXX)',
    }),
  );
}

const isBlank = (value: unknown) =>
  value === undefined || value === null || value === '';

/**
 * Correo obligatorio. A diferencia de `IsNormalizedEmail` + `IsNotEmpty`,
 * devuelve un solo mensaje: que falta, que es muy largo o que no es válido.
 */
export function IsRequiredEmail() {
  return applyDecorators(
    Transform(({ value }) => normalizeEmail(value)),
    ValidateBy({
      name: 'isRequiredEmail',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && value.length <= 254 && isEmail(value),
        defaultMessage: (args?: ValidationArguments) => {
          const value: unknown = args?.value;
          if (isBlank(value)) return 'El correo electrónico es obligatorio';
          if (typeof value === 'string' && value.length > 254) {
            return 'El correo electrónico no puede tener más de 254 caracteres';
          }
          return 'El correo electrónico no es válido';
        },
      },
    }),
  );
}

/** Teléfono obligatorio, con un solo mensaje: que falta o que no es válido. */
export function IsRequiredColombianPhone() {
  return applyDecorators(
    Transform(({ value }) => normalizePhone(value)),
    ValidateBy({
      name: 'isRequiredColombianPhone',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && COLOMBIA_PHONE_PATTERN.test(value),
        defaultMessage: (args?: ValidationArguments) =>
          isBlank(args?.value)
            ? 'El teléfono es obligatorio'
            : 'El teléfono debe ser un celular colombiano de 10 dígitos (3XXXXXXXXX) o un fijo (60XXXXXXXX)',
      },
    }),
  );
}

/** Nombres y apellidos: letras, espacios, apóstrofo, punto y guion. */
export function IsPersonName() {
  return applyDecorators(
    Transform(trim),
    IsString(),
    IsNotEmpty({ message: 'El nombre no puede estar vacío' }),
    MaxLength(60, { message: 'El nombre no puede tener más de 60 caracteres' }),
    Matches(/^\p{L}[\p{L}\s'.-]*$/u, {
      message:
        'El nombre solo puede tener letras, espacios, apóstrofos, puntos y guiones',
    }),
  );
}

/**
 * Valida el número de documento según `documentType` (otra propiedad del
 * mismo objeto). Si no viene el tipo, solo exige que no esté vacío.
 */
export function IsDocumentNumber(typeProperty = 'documentType') {
  return applyDecorators(
    Transform(
      ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) =>
        normalizeDocumentNumber(value, obj[typeProperty]),
    ),
    IsString(),
    IsNotEmpty(),
    ValidateBy({
      name: 'isDocumentNumber',
      validator: {
        validate: (value: unknown, args?: ValidationArguments) => {
          const type = (args?.object as Record<string, unknown>)[typeProperty];
          const rule =
            typeof type === 'string' ? DOCUMENT_PATTERNS[type] : undefined;
          return (
            !rule || (typeof value === 'string' && rule.pattern.test(value))
          );
        },
        defaultMessage: (args?: ValidationArguments) => {
          const type = (args?.object as Record<string, unknown>)[typeProperty];
          return (
            (typeof type === 'string' && DOCUMENT_PATTERNS[type]?.message) ||
            'Número de documento inválido'
          );
        },
      },
    }),
  );
}

/**
 * Contraseña nueva: de 8 a 72 bytes (bcrypt ignora lo que pase de 72), con al
 * menos una letra y un número. No se aplica en el login, para que las cuentas
 * creadas con la regla anterior sigan entrando.
 */
export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' }),
    ValidateBy({
      name: 'maxBytes72',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72,
        defaultMessage: () => 'La contraseña es demasiado larga',
      },
    }),
    Matches(/^(?=.*\p{L})(?=.*\d)/u, {
      message: 'La contraseña debe tener al menos una letra y un número',
    }),
  );
}
