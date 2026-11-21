import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOK_CATEGORIES,
  isValidCategory,
  validateBookFields,
  computeAverageRating,
  publicBook,
  publicUser,
} from '../lib/helpers.js';

describe('validateBookFields', () => {
  it('requires a title', () => {
    assert.equal(validateBookFields({}), 'title is required');
    assert.equal(validateBookFields({ title: '   ' }), 'title is required');
  });

  it('accepts a minimal valid book', () => {
    assert.equal(validateBookFields({ title: 'Dune' }), null);
  });

  it('rejects a non-numeric price', () => {
    assert.equal(
      validateBookFields({ title: 'Dune', price: 'abc' }),
      'price must be a number'
    );
  });

  it('rejects a negative price', () => {
    assert.equal(
      validateBookFields({ title: 'Dune', price: -5 }),
      'price must be zero or more'
    );
  });

  it('rejects pages below 1', () => {
    assert.equal(
      validateBookFields({ title: 'Dune', pages: 0 }),
      'pages must be at least 1'
    );
  });

  it('rejects an unknown category', () => {
    const msg = validateBookFields({ title: 'Dune', category: 'Cooking' });
    assert.match(msg, /category must be one of/);
  });

  it('accepts every known category', () => {
    for (const category of BOOK_CATEGORIES) {
      assert.equal(
        validateBookFields({ title: 'Dune', category }),
        null,
        `category ${category} should be valid`
      );
    }
    assert.equal(isValidCategory('Science'), true);
    assert.equal(isValidCategory('Cooking'), false);
  });

  it('partial mode only checks the fields that were sent', () => {
    assert.equal(validateBookFields({ price: 10 }, true), null);
    assert.equal(validateBookFields({ title: '' }, true), 'title is required');
    const msg = validateBookFields({ category: 'Nope' }, true);
    assert.match(msg, /category must be one of/);
  });
});

describe('computeAverageRating', () => {
  it('returns 0 with no reviews', () => {
    assert.deepEqual(computeAverageRating([]), {
      averageRating: 0,
      reviewCount: 0,
    });
    assert.deepEqual(computeAverageRating(), {
      averageRating: 0,
      reviewCount: 0,
    });
    assert.deepEqual(computeAverageRating(null), {
      averageRating: 0,
      reviewCount: 0,
    });
  });

  it('averages ratings and rounds to 1 decimal place', () => {
    assert.deepEqual(
      computeAverageRating([{ rating: 5 }, { rating: 4 }]),
      { averageRating: 4.5, reviewCount: 2 }
    );
    assert.deepEqual(
      computeAverageRating([{ rating: 5 }, { rating: 5 }, { rating: 4 }]),
      { averageRating: 4.7, reviewCount: 3 }
    );
    assert.deepEqual(computeAverageRating([{ rating: 5 }]), {
      averageRating: 5,
      reviewCount: 1,
    });
  });

  it('ignores non-numeric ratings', () => {
    assert.deepEqual(
      computeAverageRating([{ rating: 4 }, { rating: 'bad' }, {}]),
      { averageRating: 4, reviewCount: 1 }
    );
  });
});

describe('publicBook', () => {
  it('includes category, averageRating and reviewCount', () => {
    const book = publicBook({
      id: 1,
      title: 'Dune',
      category: 'Science',
      reviews: [{ rating: 5 }, { rating: 3 }],
    });
    assert.equal(book.category, 'Science');
    assert.equal(book.averageRating, 4);
    assert.equal(book.reviewCount, 2);
  });

  it('defaults category to Other and rating to 0', () => {
    const book = publicBook({ id: 2, title: 'Untitled' });
    assert.equal(book.category, 'Other');
    assert.equal(book.averageRating, 0);
    assert.equal(book.reviewCount, 0);
  });
});

describe('publicUser', () => {
  it('never exposes the password hash', () => {
    const user = publicUser({
      id: 1,
      fullName: 'A',
      email: 'a@b.com',
      phone: '123',
      password: '$2b$10$somehashvalue',
    });
    assert.equal('password' in user, false);
    assert.equal(user.password, undefined);
    assert.equal(user.email, 'a@b.com');
  });
});
