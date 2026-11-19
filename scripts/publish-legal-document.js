/**
 * Publica una versión de un documento legal en la base del entorno elegido.
 * El tipo tiene que existir en el catálogo (tabla LegalDocumentKind).
 *
 * Uso:
 *   npm run legal:publish:local -- --type PRIVACY_POLICY --version 2026-10 \
 *     --file legal/privacy-policy/2026-10.md [--url https://...] \
 *     [--published-at 2026-11-01T00:00:00-05:00]
 *
 *   npm run legal:publish:local -- --list      (tipos disponibles)
 *
 * Una versión publicada no se modifica: si el archivo cambió, hay que
 * publicarlo con otro número de versión.
 */
const { createHash } = require('crypto');
const { readFileSync } = require('fs');
const { PrismaClient } = require('@prisma/client');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`Argumento inválido: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (key === 'list') {
      args.list = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function describeKinds(kinds) {
  return kinds
    .map((kind) =>
      [
        `  ${kind.code.padEnd(28)}`,
        kind.audience.padEnd(16),
        (kind.required ? 'obligatorio' : 'opcional').padEnd(12),
        kind.active ? kind.title : `${kind.title} (inactivo)`,
      ].join(' '),
    )
    .join('\n');
}

async function publish(prisma, { type, version, file, url, publishedAtArg }) {
  // Se normalizan los saltos de línea para que el mismo texto tenga la misma
  // huella en Windows y en Linux.
  const content = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim() + '\n';
  const contentHash = createHash('sha256').update(content).digest('hex');
  const publishedAt = publishedAtArg ? new Date(publishedAtArg) : new Date();
  if (Number.isNaN(publishedAt.getTime())) throw new Error('--published-at no es una fecha válida');

  const existing = await prisma.legalDocument.findUnique({
    where: { type_version: { type, version } },
  });

  if (existing) {
    if (existing.contentHash === contentHash) {
      console.log(`${type} ${version} ya estaba publicado con el mismo texto. Sin cambios.`);
      return;
    }
    throw new Error(
      `${type} ${version} ya existe con otro texto. Una versión publicada no se modifica: usa otro número de versión.`,
    );
  }

  const document = await prisma.legalDocument.create({
    data: { type, version, content, contentHash, url, publishedAt },
  });
  console.log(`Publicado ${type} ${version}`);
  console.log(`  id:          ${document.id}`);
  console.log(`  vigente desde ${document.publishedAt.toISOString()}`);
  console.log(`  sha256:      ${contentHash}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const kinds = await prisma.legalDocumentKind.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    if (args.list) {
      console.log(`Tipos de documento:\n${describeKinds(kinds)}`);
      return;
    }

    const kind = kinds.find((item) => item.code === args.type);
    if (!kind) throw new Error(`--type debe ser uno de:\n${describeKinds(kinds)}`);
    if (!kind.active) {
      console.warn(`Aviso: ${kind.code} está inactivo: la versión se guarda, pero no se sirve ni se exige.`);
    }
    if (!args.version) throw new Error('Falta --version');
    if (!args.file) throw new Error('Falta --file');

    await publish(prisma, {
      type: kind.code,
      version: args.version,
      file: args.file,
      url: args.url,
      publishedAtArg: args['published-at'],
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
