export function buildWhere({
  search,
  searchFields = [],
  filters = {},
}: {
  search?: string;
  searchFields?: string[];
  filters?: Record<string, any>;
}) {
  const where: Record<string, any> = { ...filters };

  if (search && searchFields.length) {
    const searchOr = searchFields.map((field) => ({
      [field]: {
        contains: search,
        mode: 'insensitive',
      },
    }));
    // Si los filtros ya traen un OR (por ejemplo, "negocios del usuario"),
    // la búsqueda se suma con AND: reemplazarlo devolvería registros ajenos.
    if (where.OR) {
      const and: unknown[] = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [...and, { OR: searchOr }];
    } else {
      where.OR = searchOr;
    }
  }

  return where;
}
