import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Files ka sahi rasta (Path)
const USERS_FILE = path.join(__dirname, 'users.json');
const BOOKS_FILE = path.join(__dirname, 'books.json');

// Majboot Read Function
const readDB = (f) => {
    try {
        if (!fs.existsSync(f)) return [];
        const data = fs.readFileSync(f, 'utf8');
        return data ? JSON.parse(data) : [];
    } catch (err) {
        console.error("Read error:", err);
        return [];
    }
};

// Majboot Write Function
const writeDB = (f, d) => {
    try {
        fs.writeFileSync(f, JSON.stringify(d, null, 2));
    } catch (err) {
        console.error("Write error (Render limitation):", err);
    }
};

app.post('/api/auth/signup', (req, res) => {
    try {
        const users = readDB(USERS_FILE);
        users.push(req.body);
        writeDB(USERS_FILE, users);
        res.status(201).json({ msg: "Success" });
    } catch (err) {
        res.status(500).json({ msg: "Signup fail: Server error" });
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body;
        const users = readDB(USERS_FILE);
        const user = users.find(u => u.email === email && u.password === password);
        user ? res.json({ user }) : res.status(401).json({ msg: "Fail" });
    } catch (err) {
        res.status(500).json({ msg: "Login error" });
    }
});

app.get('/api/books', (req, res) => res.json(readDB(BOOKS_FILE)));

app.post('/api/books/add', (req, res) => {
    try {
        const books = readDB(BOOKS_FILE);
        books.push({ id: Date.now(), ...req.body });
        writeDB(BOOKS_FILE, books);
        res.status(201).json({ msg: "Success" });
    } catch (err) {
        res.status(500).json({ msg: "Upload error" });
    }
});

app.delete('/api/books/:id', (req, res) => {
    try {
        const books = readDB(BOOKS_FILE).filter(b => b.id !== parseInt(req.params.id));
        writeDB(BOOKS_FILE, books);
        res.json({ msg: "Deleted" });
    } catch (err) {
        res.status(500).json({ msg: "Delete error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
