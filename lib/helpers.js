// Shared pure helpers: validation, categories and rating maths.
// Kept free of Express/Mongoose so they can be unit-tested with node:test.

export const BOOK_CATEGORIES = [
  'Fiction',
  'Non-Fiction',
  'Science',
  'History',
  'Technology',
  'Children',
  'Other',
];

export const isValidCategory = (value) =>
  typeof value === 'string' && BOOK_CATEGORIES.includes(value);

export const toNumberIfPresent = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// Validate book fields. Returns an error message string, or null if OK.
// `partial` = true for PUT (only validate the fields that were sent).
export function validateBookFields(body, partial = false) {
  if (!partial || body.title !== undefined) {
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return 'title is required';
    }
  }
  const price = toNumberIfPresent(body.price);
  if (body.price !== undefined && body.price !== '' && Number.isNaN(price)) {
    return 'price must be a number';
  }
  if (price !== undefined && price < 0) {
    return 'price must be zero or more';
  }
  const pages = toNumberIfPresent(body.pages);
  if (body.pages !== undefined && body.pages !== '' && Number.isNaN(pages)) {
    return 'pages must be a number';
  }
  if (pages !== undefined && pages < 1) {
    return 'pages must be at least 1';
  }
  if (body.category !== undefined && !isValidCategory(body.category)) {
    return `category must be one of: ${BOOK_CATEGORIES.join(', ')}`;
  }
  return null;
}

// Average rating of a reviews array. Returns { averageRating, reviewCount }.
// averageRating is rounded to 1 decimal place; 0 when there are no reviews.
export function computeAverageRating(reviews) {
  const list = Array.isArray(reviews) ? reviews : [];
  const ratings = list
    .map((r) => Number(r && r.rating))
    .filter((n) => Number.isFinite(n));
  const reviewCount = ratings.length;
  if (reviewCount === 0) return { averageRating: 0, reviewCount: 0 };
  const sum = ratings.reduce((a, b) => a + b, 0);
  return {
    averageRating: Math.round((sum / reviewCount) * 10) / 10,
    reviewCount,
  };
}

// Public view of a book - includes category and the rating summary.
// Works for Mongoose documents and plain JSON-file records.
export function publicBook(b) {
  const { averageRating, reviewCount } = computeAverageRating(b.reviews);
  return {
    id: b.id !== undefined ? b.id : b._id,
    title: b.title,
    author: b.author,
    price: b.price,
    pages: b.pages,
    description: b.description,
    category: b.category || 'Other',
    averageRating,
    reviewCount,
    owner: b.owner,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

// Public view of a user - never send the password hash back.
export function publicUser(u) {
  return {
    id: u.id || u._id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
  };
}
