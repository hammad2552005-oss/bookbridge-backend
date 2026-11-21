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

if (!process.env.JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set. Using an insecure dev default. ' +
      'Set JWT_SECRET in your .env file (see .env.example).'
  );
}

// Files ka sahi rasta (Path)
const USERS_FILE = path.join(__dirname, 'users.json');
const BOOKS_FILE = path.join(__dirname, 'books.json');

// ---------------------------------------------------------------------------
// Storage: MongoDB (mongoose) when MONGODB_URI is set, otherwise the
// existing JSON-file storage (users.json / books.json). The API behaves
// the same either way.
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

const toNumberIfPresent = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// A bcrypt hash always starts with $2a$ / $2b$ / $2y$. Anything else stored
// as a password is a legacy plain-text password from the old JSON data.
const isBcryptHash = (value) =>
  typeof value === 'string' && /^\$2[aby]\$/.test(value);

// Public view of a user - never send the password hash back.
const publicUser = (u) => ({
  id: u.id || u._id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
});

const publicBook = (b) => ({
  id: b.id !== undefined ? b.id : b._id,
  title: b.title,
  author: b.author,
  price: b.price,
  pages: b.pages,
  description: b.description,
  owner: b.owner,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

// --- User store -------------------------------------------------------------
async function findUserByEmail(email) {
  if (useMongo) return User.findOne({ email });
  return readDB(USERS_FILE).find((u) => u.email === email) || null;
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

// --- Book store -------------------------------------------------------------
function bookMatchesQuery(book, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (book.title && book.title.toLowerCase().includes(needle)) ||
    (book.author && book.author.toLowerCase().includes(needle))
  );
}

async function listBooks({ q, page, limit }) {
  if (useMongo) {
    const filter = q
      ? {
          $or: [
            { title: { $regex: q, $options: 'i' } },
            { author: { $regex: q, $options: 'i' } },
          ],
        }
      : {};
    const total = await Book.countDocuments(filter);
    const books = await Book.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    return { books: books.map(publicBook), total };
  }
  const all = readDB(BOOKS_FILE).filter((b) => bookMatchesQuery(b, q));
  const total = all.length;
  const books = all.slice((page - 1) * limit, page * limit);
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

async function addBook({ title, author, price, pages, description, owner }) {
  if (useMongo) {
    const book = new Book({ title, author, price, pages, description, owner });
    await book.save();
    return book;
  }
  const books = readDB(BOOKS_FILE);
  const book = {
    id: Date.now(),
    title,
    author,
    price,
    pages,
    description,
    owner,
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
  Object.assign(book, fields);
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

// Validate book fields. Returns an error message string, or null if OK.
// `partial` = true for PUT (only validate the fields that were sent).
function validateBookFields(body, partial = false) {
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
  return null;
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
// GET /api/books?q=search&page=1&limit=10
// Without query params it returns the plain books array (old behaviour).
// With ?q=, ?page= or ?limit= it returns { books, page, limit, total, totalPages }.
app.get('/api/books', async (req, res) => {
  try {
    const usePaging =
      req.query.q !== undefined ||
      req.query.page !== undefined ||
      req.query.limit !== undefined;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10)
    );
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const { books, total } = await listBooks({ q, page, limit });

    if (!usePaging) {
      // Old behaviour: return every book as a plain array.
      const all = await listBooks({ q: '', page: 1, limit: total || 1000 });
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
// 404 + error handler
// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).json({ msg: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  return res.status(500).json({ msg: 'Server error' });
});

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
