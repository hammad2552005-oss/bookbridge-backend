import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import auth from './middleware/auth.js';
import User from './models/User.js';
import Book from './models/Book.js';
import ExchangeRequest from './models/ExchangeRequest.js';
import {
  BOOK_CATEGORIES,
  isValidCategory,
  toNumberIfPresent,
  validateBookFields,
  computeAverageRating,
  publicBook,
  publicUser,
} from './lib/helpers.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MONGODB_URI = process.env.MONGODB_URI || '';
// The user whose email matches ADMIN_EMAIL is the admin (see /api/admin/*).
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

if (!process.env.JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set. Using an insecure dev default. ' +
      'Set JWT_SECRET in your .env file (see .env.example).'
  );
}

// Files ka sahi rasta (Path)
const USERS_FILE = path.join(__dirname, 'users.json');
const BOOKS_FILE = path.join(__dirname, 'books.json');
const REQUESTS_FILE = path.join(__dirname, 'requests.json');

// ---------------------------------------------------------------------------
// Storage: MongoDB (mongoose) when MONGODB_URI is set, otherwise the
// existing JSON-file storage (users.json / books.json / requests.json).
// The API behaves the same either way.
// ---------------------------------------------------------------------------
let useMongo = false;

if (MONGODB_URI) {
  try {
    await mongoose.connect(MONGODB_URI);
    useMongo = true;
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error(
      'MongoDB connection failed, falling back to JSON-file storage:',
      err.message
    );
  }
} else {
  console.log('MONGODB_URI not set - using JSON-file storage');
}

// Majboot Read Function (JSON-file mode)
const readDB = (f) => {
  try {
    if (!fs.existsSync(f)) return [];
    const data = fs.readFileSync(f, 'utf8');
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('Read error:', err);
    return [];
  }
};

// Majboot Write Function (JSON-file mode)
const writeDB = (f, d) => {
  try {
    fs.writeFileSync(f, JSON.stringify(d, null, 2));
  } catch (err) {
    console.error('Write error (Render limitation):', err);
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const isValidEmail = (email) =>
  typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// A bcrypt hash always starts with $2a$ / $2b$ / $2y$. Anything else stored
// as a password is a legacy plain-text password from the old JSON data.
const isBcryptHash = (value) =>
  typeof value === 'string' && /^\$2[aby]\$/.test(value);

// --- User store -------------------------------------------------------------
async function findUserByEmail(email) {
  if (useMongo) return User.findOne({ email });
  return readDB(USERS_FILE).find((u) => u.email === email) || null;
}

async function getUserById(id) {
  if (useMongo) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return User.findById(id);
  }
  return readDB(USERS_FILE).find((u) => String(u.id) === String(id)) || null;
}

async function listAllUsers() {
  if (useMongo) return User.find({});
  return readDB(USERS_FILE);
}

async function createUser({ fullName, email, passwordHash, phone }) {
  if (useMongo) {
    const user = new User({ fullName, email, password: passwordHash, phone });
    await user.save();
    return user;
  }
  const users = readDB(USERS_FILE);
  const user = {
    id: Date.now(),
    fullName,
    email,
    password: passwordHash,
    phone,
    wishlist: [],
  };
  users.push(user);
  writeDB(USERS_FILE, users);
  return user;
}

// Re-hash a legacy plain-text password after a successful login.
async function migrateLegacyPassword(user, plainPassword) {
  const hash = await bcrypt.hash(plainPassword, 10);
  if (useMongo) {
    user.password = hash;
    await user.save();
  } else {
    const users = readDB(USERS_FILE);
    const stored = users.find((u) => u.email === user.email);
    if (stored) {
      stored.password = hash;
      writeDB(USERS_FILE, users);
    }
  }
}

// Toggle a book in the user's wishlist. Returns { wishlisted, wishlist }
// (wishlist is an array of book-id strings), or null if the user is gone.
async function toggleWishlist(userId, bookId) {
  if (useMongo) {
    const user = await User.findById(userId);
    if (!user) return null;
    const index = user.wishlist.findIndex(
      (w) => String(w) === String(bookId)
    );
    let wishlisted;
    if (index === -1) {
      user.wishlist.push(bookId);
      wishlisted = true;
    } else {
      user.wishlist.splice(index, 1);
      wishlisted = false;
    }
    await user.save();
    return { wishlisted, wishlist: user.wishlist.map((w) => String(w)) };
  }
  const users = readDB(USERS_FILE);
  const user = users.find((u) => String(u.id) === String(userId));
  if (!user) return null;
  if (!Array.isArray(user.wishlist)) user.wishlist = [];
  const index = user.wishlist.findIndex(
    (w) => String(w) === String(bookId)
  );
  let wishlisted;
  if (index === -1) {
    user.wishlist.push(bookId);
    wishlisted = true;
  } else {
    user.wishlist.splice(index, 1);
    wishlisted = false;
  }
  writeDB(USERS_FILE, users);
  return { wishlisted, wishlist: user.wishlist.map((w) => String(w)) };
}

// --- Book store -------------------------------------------------------------
function bookMatchesQuery(book, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (book.title && book.title.toLowerCase().includes(needle)) ||
    (book.author && book.author.toLowerCase().includes(needle))
  );
}

function bookMatchesCategory(book, category) {
  if (!category) return true;
  return book.category === category;
}

// Sorting for JSON-file mode, and for the `rating` sort in Mongo mode
// (the average rating is computed from the embedded reviews, so it is
// sorted in JS). `sort` is one of newest | price-asc | price-desc | rating.
function sortBooks(books, sort) {
  const sorted = [...books];
  const stamp = (b) =>
    b.createdAt ? new Date(b.createdAt).getTime() : Number(b.id) || 0;
  switch (sort) {
    case 'price-asc':
      sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      break;
    case 'price-desc':
      sorted.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
      break;
    case 'rating':
      sorted.sort(
        (a, b) =>
          computeAverageRating(b.reviews).averageRating -
            computeAverageRating(a.reviews).averageRating ||
          stamp(b) - stamp(a)
      );
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => stamp(b) - stamp(a));
      break;
  }
  return sorted;
}

async function listBooks({ q, category, sort = 'newest', page, limit }) {
  if (useMongo) {
    const filter = {};
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { author: { $regex: q, $options: 'i' } },
      ];
    }
    if (category) filter.category = category;

    if (sort === 'rating') {
      // Average rating is computed from the embedded reviews, so sort in JS.
      const all = await Book.find(filter);
      const sorted = sortBooks(all, 'rating');
      const total = sorted.length;
      const books = sorted.slice((page - 1) * limit, page * limit);
      return { books: books.map(publicBook), total };
    }

    const mongoSort =
      sort === 'price-asc'
        ? { price: 1 }
        : sort === 'price-desc'
          ? { price: -1 }
          : { createdAt: -1 };
    const total = await Book.countDocuments(filter);
    const books = await Book.find(filter)
      .sort(mongoSort)
      .skip((page - 1) * limit)
      .limit(limit);
    return { books: books.map(publicBook), total };
  }
  const filtered = readDB(BOOKS_FILE)
    .filter((b) => bookMatchesQuery(b, q))
    .filter((b) => bookMatchesCategory(b, category));
  const sorted = sortBooks(filtered, sort);
  const total = sorted.length;
  const books = sorted.slice((page - 1) * limit, page * limit);
  return { books: books.map(publicBook), total };
}

async function getBookById(id) {
  if (useMongo) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return Book.findById(id);
  }
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return readDB(BOOKS_FILE).find((b) => b.id === numId) || null;
}

async function addBook({
  title,
  author,
  price,
  pages,
  description,
  category,
  owner,
}) {
  if (useMongo) {
    const book = new Book({
      title,
      author,
      price,
      pages,
      description,
      category,
      owner,
    });
    await book.save();
    return book;
  }
  const books = readDB(BOOKS_FILE);
  const now = new Date().toISOString();
  const book = {
    id: Date.now(),
    title,
    author,
    price,
    pages,
    description,
    category: category || 'Other',
    reviews: [],
    owner,
    createdAt: now,
    updatedAt: now,
  };
  books.push(book);
  writeDB(BOOKS_FILE, books);
  return book;
}

async function updateBook(id, fields) {
  if (useMongo) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return Book.findByIdAndUpdate(id, fields, { new: true });
  }
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  const books = readDB(BOOKS_FILE);
  const book = books.find((b) => b.id === numId);
  if (!book) return null;
  Object.assign(book, fields, { updatedAt: new Date().toISOString() });
  writeDB(BOOKS_FILE, books);
  return book;
}

async function deleteBook(id) {
  if (useMongo) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return Book.findByIdAndDelete(id);
  }
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  const books = readDB(BOOKS_FILE);
  const index = books.findIndex((b) => b.id === numId);
  if (index === -1) return null;
  const [removed] = books.splice(index, 1);
  writeDB(BOOKS_FILE, books);
  return removed;
}

// --- Reviews (stored inside the book record) -------------------------------
function publicReview(r) {
  return {
    user: r.user !== undefined ? String(r.user) : r.userId,
    rating: r.rating,
    text: r.text || '',
    createdAt: r.createdAt,
  };
}

// Add a review, or update the same user's existing review on this book.
// Returns { book, created } or null when the book does not exist.
async function addOrUpdateReview(bookId, userId, rating, text) {
  const book = await getBookById(bookId);
  if (!book) return null;
  if (useMongo) {
    const existing = book.reviews.find(
      (r) => String(r.user) === String(userId)
    );
    let created = false;
    if (existing) {
      existing.rating = rating;
      existing.text = text;
    } else {
      book.reviews.push({ user: userId, rating, text });
      created = true;
    }
    await book.save();
    return { book, created };
  }
  if (!Array.isArray(book.reviews)) book.reviews = [];
  const existing = book.reviews.find(
    (r) => String(r.userId) === String(userId)
  );
  let created = false;
  if (existing) {
    existing.rating = rating;
    existing.text = text;
  } else {
    book.reviews.push({
      userId,
      rating,
      text,
      createdAt: new Date().toISOString(),
    });
    created = true;
  }
  const books = readDB(BOOKS_FILE);
  const index = books.findIndex((b) => b.id === book.id);
  if (index !== -1) {
    books[index] = book;
    writeDB(BOOKS_FILE, books);
  }
  return { book, created };
}

// --- Exchange / borrow requests --------------------------------------------
const REQUEST_STATUSES = ['pending', 'approved', 'rejected'];

function publicRequest(r, book) {
  return {
    id: r.id !== undefined ? r.id : r._id,
    book: book
      ? {
          id: book.id !== undefined ? book.id : book._id,
          title: book.title,
          author: book.author,
        }
      : { id: r.book !== undefined ? r.book : r.bookId },
    requester: r.requester,
    owner: r.owner,
    status: r.status,
    message: r.message,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function createExchangeRequest({ bookId, requester, owner, message }) {
  if (useMongo) {
    const reqDoc = new ExchangeRequest({
      book: bookId,
      requester,
      owner,
      message,
    });
    await reqDoc.save();
    return reqDoc;
  }
  const requests = readDB(REQUESTS_FILE);
  const now = new Date().toISOString();
  const reqDoc = {
    id: Date.now(),
    bookId,
    requester,
    owner,
    status: 'pending',
    message: message || '',
    createdAt: now,
    updatedAt: now,
  };
  requests.push(reqDoc);
  writeDB(REQUESTS_FILE, requests);
  return reqDoc;
}

async function getRequestById(id) {
  if (useMongo) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return ExchangeRequest.findById(id);
  }
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return readDB(REQUESTS_FILE).find((r) => r.id === numId) || null;
}

async function listRequestsForUser(userId) {
  if (useMongo) {
    return ExchangeRequest.find({
      $or: [{ requester: userId }, { owner: userId }],
    }).sort({ createdAt: -1 });
  }
  return readDB(REQUESTS_FILE)
    .filter(
      (r) =>
        String(r.requester) === String(userId) ||
        String(r.owner) === String(userId)
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function findPendingRequest(bookId, requester) {
  if (useMongo) {
    return ExchangeRequest.findOne({
      book: bookId,
      requester,
      status: 'pending',
    });
  }
  return (
    readDB(REQUESTS_FILE).find(
      (r) =>
        String(r.bookId) === String(bookId) &&
        String(r.requester) === String(requester) &&
        r.status === 'pending'
    ) || null
  );
}

async function updateRequestStatus(id, status) {
  if (useMongo) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return ExchangeRequest.findByIdAndUpdate(id, { status }, { new: true });
  }
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  const requests = readDB(REQUESTS_FILE);
  const reqDoc = requests.find((r) => r.id === numId);
  if (!reqDoc) return null;
  reqDoc.status = status;
  reqDoc.updatedAt = new Date().toISOString();
  writeDB(REQUESTS_FILE, requests);
  return reqDoc;
}

// Attach a small book summary to each request (same shape, both storages).
async function withBookSummary(requests) {
  const out = [];
  for (const r of requests) {
    const bookId = r.book !== undefined ? r.book : r.bookId;
    const book = await getBookById(String(bookId));
    out.push(publicRequest(r, book));
  }
  return out;
}

// --- Admin ------------------------------------------------------------------
const isAdmin = (req) =>
  Boolean(ADMIN_EMAIL) &&
  req.user &&
  typeof req.user.email === 'string' &&
  req.user.email.toLowerCase() === ADMIN_EMAIL;

function adminOnly(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ msg: 'Admin access required' });
  }
  return next();
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/', (req, res) =>
  res.json({ status: 'ok', storage: useMongo ? 'mongodb' : 'json-file' })
);

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body || {};

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({ msg: 'fullName is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ msg: 'A valid email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res
        .status(400)
        .json({ msg: 'password must be at least 6 characters' });
    }

    const existing = await findUserByEmail(email.toLowerCase().trim());
    if (existing) {
      return res.status(400).json({ msg: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      phone: phone ? String(phone).trim() : undefined,
    });

    return res.status(201).json({ msg: 'Success', user: publicUser(user) });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ msg: 'Signup fail: Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ msg: 'email and password are required' });
    }

    const user = await findUserByEmail(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ msg: 'Fail' });
    }

    let passwordOk = false;
    if (isBcryptHash(user.password)) {
      passwordOk = await bcrypt.compare(password, user.password);
    } else {
      // Legacy user created before hashing: plain-text password stored in
      // users.json. Accept it once, then upgrade it to a bcrypt hash.
      passwordOk = password === user.password;
      if (passwordOk) {
        await migrateLegacyPassword(user, password);
      }
    }

    if (!passwordOk) {
      return res.status(401).json({ msg: 'Fail' });
    }

    const token = jwt.sign(
      { id: user.id || user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({ user: publicUser(user), token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ msg: 'Login error' });
  }
});

// ---------------------------------------------------------------------------
// Book routes
// ---------------------------------------------------------------------------
// GET /api/books?q=&category=&sort=&page=&limit=
// Without query params it returns the plain books array (old behaviour).
// With ?q=, ?category=, ?sort=, ?page= or ?limit= it returns
// { books, page, limit, total, totalPages }.
// sort: newest | price-asc | price-desc | rating (default: newest)
app.get('/api/books', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category =
      typeof req.query.category === 'string'
        ? req.query.category.trim()
        : '';
    const sort =
      typeof req.query.sort === 'string' ? req.query.sort.trim() : 'newest';

    if (category && !isValidCategory(category)) {
      return res.status(400).json({
        msg: `category must be one of: ${BOOK_CATEGORIES.join(', ')}`,
      });
    }
    if (!['newest', 'price-asc', 'price-desc', 'rating'].includes(sort)) {
      return res.status(400).json({
        msg: 'sort must be one of: newest, price-asc, price-desc, rating',
      });
    }

    const usePaging =
      req.query.q !== undefined ||
      req.query.page !== undefined ||
      req.query.limit !== undefined ||
      req.query.category !== undefined ||
      req.query.sort !== undefined;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10)
    );

    const { books, total } = await listBooks({
      q,
      category: category || undefined,
      sort,
      page,
      limit,
    });

    if (!usePaging) {
      // Old behaviour: return every book as a plain array.
      const all = await listBooks({
        q: '',
        category: undefined,
        sort,
        page: 1,
        limit: total || 1000,
      });
      return res.json(all.books);
    }

    return res.json({
      books,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('List books error:', err);
    return res.status(500).json({ msg: 'Could not list books' });
  }
});

app.post('/api/books/add', auth, async (req, res) => {
  try {
    const error = validateBookFields(req.body);
    if (error) return res.status(400).json({ msg: error });

    const book = await addBook({
      title: req.body.title.trim(),
      author: req.body.author ? String(req.body.author).trim() : undefined,
      price: toNumberIfPresent(req.body.price),
      pages: toNumberIfPresent(req.body.pages),
      description: req.body.description
        ? String(req.body.description).trim()
        : undefined,
      category: req.body.category
        ? String(req.body.category).trim()
        : undefined,
      owner: req.user.id,
    });

    return res.status(201).json({ msg: 'Success', book: publicBook(book) });
  } catch (err) {
    console.error('Add book error:', err);
    return res.status(500).json({ msg: 'Upload error' });
  }
});

app.put('/api/books/:id', auth, async (req, res) => {
  try {
    const error = validateBookFields(req.body, true);
    if (error) return res.status(400).json({ msg: error });

    const fields = {};
    if (req.body.title !== undefined) fields.title = String(req.body.title).trim();
    if (req.body.author !== undefined) fields.author = String(req.body.author).trim();
    if (req.body.price !== undefined) fields.price = toNumberIfPresent(req.body.price);
    if (req.body.pages !== undefined) fields.pages = toNumberIfPresent(req.body.pages);
    if (req.body.description !== undefined) {
      fields.description = String(req.body.description).trim();
    }
    if (req.body.category !== undefined) {
      fields.category = String(req.body.category).trim();
    }

    const book = await updateBook(req.params.id, fields);
    if (!book) return res.status(404).json({ msg: 'Book not found' });
    return res.json({ msg: 'Success', book: publicBook(book) });
  } catch (err) {
    console.error('Update book error:', err);
    return res.status(500).json({ msg: 'Update error' });
  }
});

app.delete('/api/books/:id', auth, async (req, res) => {
  try {
    const removed = await deleteBook(req.params.id);
    if (!removed) return res.status(404).json({ msg: 'Book not found' });
    return res.json({ msg: 'Deleted' });
  } catch (err) {
    console.error('Delete book error:', err);
    return res.status(500).json({ msg: 'Delete error' });
  }
});

// ---------------------------------------------------------------------------
// Review routes
// ---------------------------------------------------------------------------
app.get('/api/books/:id/reviews', async (req, res) => {
  try {
    const book = await getBookById(req.params.id);
    if (!book) return res.status(404).json({ msg: 'Book not found' });
    const reviews = (book.reviews || []).map(publicReview);
    const { averageRating, reviewCount } = computeAverageRating(
      book.reviews
    );
    return res.json({
      book: publicBook(book),
      reviews,
      averageRating,
      reviewCount,
    });
  } catch (err) {
    console.error('List reviews error:', err);
    return res.status(500).json({ msg: 'Could not list reviews' });
  }
});

app.post('/api/books/:id/reviews', auth, async (req, res) => {
  try {
    const book = await getBookById(req.params.id);
    if (!book) return res.status(404).json({ msg: 'Book not found' });

    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ msg: 'rating must be an integer between 1 and 5' });
    }
    const text = req.body?.text ? String(req.body.text).trim() : '';
    if (text.length > 1000) {
      return res
        .status(400)
        .json({ msg: 'review text must be at most 1000 characters' });
    }

    const result = await addOrUpdateReview(
      req.params.id,
      req.user.id,
      rating,
      text
    );
    const { averageRating, reviewCount } = computeAverageRating(
      result.book.reviews
    );
    return res.status(result.created ? 201 : 200).json({
      msg: 'Review saved',
      book: publicBook(result.book),
      averageRating,
      reviewCount,
    });
  } catch (err) {
    console.error('Add review error:', err);
    return res.status(500).json({ msg: 'Could not save review' });
  }
});

// ---------------------------------------------------------------------------
// Exchange / borrow request routes
// ---------------------------------------------------------------------------
app.post('/api/books/:id/request', auth, async (req, res) => {
  try {
    const book = await getBookById(req.params.id);
    if (!book) return res.status(404).json({ msg: 'Book not found' });
    if (book.owner && String(book.owner) === String(req.user.id)) {
      return res
        .status(400)
        .json({ msg: 'You cannot request your own book' });
    }
    const existing = await findPendingRequest(req.params.id, req.user.id);
    if (existing) {
      return res.status(400).json({
        msg: 'You already have a pending request for this book',
      });
    }
    const message = req.body?.message ? String(req.body.message).trim() : '';
    if (message.length > 500) {
      return res
        .status(400)
        .json({ msg: 'message must be at most 500 characters' });
    }
    const request = await createExchangeRequest({
      bookId: req.params.id,
      requester: req.user.id,
      owner: book.owner,
      message,
    });
    const [withBook] = await withBookSummary([request]);
    return res.status(201).json({ msg: 'Request created', request: withBook });
  } catch (err) {
    console.error('Create request error:', err);
    return res.status(500).json({ msg: 'Could not create request' });
  }
});

app.get('/api/requests', auth, async (req, res) => {
  try {
    const requests = await listRequestsForUser(req.user.id);
    const out = await withBookSummary(requests);
    return res.json(out);
  } catch (err) {
    console.error('List requests error:', err);
    return res.status(500).json({ msg: 'Could not list requests' });
  }
});

app.put('/api/requests/:id', auth, async (req, res) => {
  try {
    const status = req.body?.status;
    if (status !== 'approved' && status !== 'rejected') {
      return res
        .status(400)
        .json({ msg: "status must be 'approved' or 'rejected'" });
    }
    const request = await getRequestById(req.params.id);
    if (!request) return res.status(404).json({ msg: 'Request not found' });
    if (!request.owner || String(request.owner) !== String(req.user.id)) {
      return res.status(403).json({
        msg: 'Only the book owner can approve or reject requests',
      });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ msg: 'Request is no longer pending' });
    }
    const updated = await updateRequestStatus(req.params.id, status);
    const [withBook] = await withBookSummary([updated]);
    return res.json({ msg: 'Success', request: withBook });
  } catch (err) {
    console.error('Update request error:', err);
    return res.status(500).json({ msg: 'Could not update request' });
  }
});

// ---------------------------------------------------------------------------
// Wishlist routes
// ---------------------------------------------------------------------------
app.post('/api/books/:id/wishlist', auth, async (req, res) => {
  try {
    const book = await getBookById(req.params.id);
    if (!book) return res.status(404).json({ msg: 'Book not found' });
    const bookId = book.id !== undefined ? book.id : book._id;
    const result = await toggleWishlist(req.user.id, bookId);
    if (!result) return res.status(404).json({ msg: 'User not found' });
    return res.json({
      msg: result.wishlisted ? 'Added to wishlist' : 'Removed from wishlist',
      wishlisted: result.wishlisted,
      wishlist: result.wishlist,
    });
  } catch (err) {
    console.error('Wishlist error:', err);
    return res.status(500).json({ msg: 'Could not update wishlist' });
  }
});

app.get('/api/users/me/wishlist', auth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const books = [];
    for (const id of user.wishlist || []) {
      const book = await getBookById(String(id));
      if (book) books.push(publicBook(book));
    }
    return res.json(books);
  } catch (err) {
    console.error('Wishlist list error:', err);
    return res.status(500).json({ msg: 'Could not list wishlist' });
  }
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------
app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await listAllUsers();
    // publicUser strips the password hash - it is never sent back.
    return res.json(users.map(publicUser));
  } catch (err) {
    console.error('Admin list users error:', err);
    return res.status(500).json({ msg: 'Could not list users' });
  }
});

// ---------------------------------------------------------------------------
// 404 + error handler
// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).json({ msg: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  return res.status(500).json({ msg: 'Server error' });
});

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
