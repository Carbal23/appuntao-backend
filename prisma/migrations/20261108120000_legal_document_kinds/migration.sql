-- Los tipos de documento legal pasan de un enum a un catálogo. Un tipo nuevo
-- es una fila más: no hace falta otra migración ni otra versión de la app.
--
-- Tipos con los que se sale a producción (Colombia):
--  - Términos y Condiciones: el contrato de uso (Ley 527 de 1999, Ley 1480 de 2011).
--  - Política de Tratamiento de Datos Personales: obligatoria para todo
--    Responsable (Ley 1581 de 2012, Decreto 1074 de 2015).
--  - Acuerdo de Transmisión de Datos Personales: el tendero es Responsable de
--    los datos de sus clientes y Appuntao los trata por cuenta suya como
--    Encargado (Decreto 1074 de 2015, art. 2.2.2.25.5.2). Se exige a quien
--    crea o tiene un negocio.

-- CreateEnum
CREATE TYPE "LegalAudience" AS ENUM ('ALL_USERS', 'BUSINESS_OWNERS');

-- CreateTable
CREATE TABLE "LegalDocumentKind" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "audience" "LegalAudience" NOT NULL DEFAULT 'ALL_USERS',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocumentKind_pkey" PRIMARY KEY ("code")
);

-- Seed: los tipos que ya existían conservan su código.
INSERT INTO "LegalDocumentKind" ("code", "title", "audience", "required", "sortOrder", "updatedAt") VALUES
    ('TERMS_AND_CONDITIONS', 'Términos y Condiciones', 'ALL_USERS', true, 10, CURRENT_TIMESTAMP),
    ('PRIVACY_POLICY', 'Política de Tratamiento de Datos Personales', 'ALL_USERS', true, 20, CURRENT_TIMESTAMP),
    ('DATA_PROCESSING_AGREEMENT', 'Acuerdo de Transmisión de Datos Personales', 'BUSINESS_OWNERS', true, 30, CURRENT_TIMESTAMP);

-- AlterTable: el enum pasa a texto con los mismos valores.
ALTER TABLE "LegalDocument" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

-- DropEnum
DROP TYPE "LegalDocumentType";

-- AddForeignKey
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_type_fkey" FOREIGN KEY ("type") REFERENCES "LegalDocumentKind"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
