function parsePage(value, fallback = 1) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function parseLimit(value, fallback = 20, maxLimit = 100) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1) return fallback;
  return Math.min(num, maxLimit);
}

function parseSort(value, defaultSort = '-createdAt') {
  if (!value || typeof value !== 'string') return defaultSort;
  return value;
}

async function paginate(model, query = {}, options = {}) {
  const {
    page: rawPage,
    limit: rawLimit,
    sort: rawSort,
    populate,
    select,
    lean = true,
  } = options;

  const page = parsePage(rawPage);
  const limit = parseLimit(rawLimit);
  const sort = parseSort(rawSort);
  const skip = (page - 1) * limit;

  const [total, docs] = await Promise.all([
    model.countDocuments(query),
    model.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate(populate || [])
      .select(select || '')
      .lean(lean)
      .exec(),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    data: docs,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = { paginate, parsePage, parseLimit, parseSort };
