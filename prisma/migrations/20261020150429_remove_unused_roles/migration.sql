-- Se quitan los roles MODERATOR y SUSPENDED, que ningún código usaba. Un
-- usuario suspendido pasa a ser una cuenta desactivada por un administrador,
-- que es como se bloquea una cuenta ahora.

BEGIN;
UPDATE "User"
SET "role" = 'USER',
    "inactivatedAt" = COALESCE("inactivatedAt", now()),
    "inactivatedBy" = 'ADMIN'
WHERE "role" = 'SUSPENDED';

UPDATE "User" SET "role" = 'USER' WHERE "role" = 'MODERATOR';

-- AlterEnum
CREATE TYPE "Role_new" AS ENUM ('USER', 'ADMIN');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
COMMIT;

