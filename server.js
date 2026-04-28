import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const USERS_FILE = 'users.json';
const BOOKS_FILE = 'books.json';

const readDB = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : [];
const writeDB = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

app.post('/api/auth/signup', (req, res) => {
    const users = readDB(USERS_FILE);
    users.push(req.body);
    writeDB(USERS_FILE, users);
    res.status(201).json({ msg: "Success" });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = readDB(USERS_FILE).find(u => u.email === email && u.password === password);
    user ? res.json({ user }) : res.status(401).json({ msg: "Fail" });
});

app.get('/api/books', (req, res) => res.json(readDB(BOOKS_FILE)));

app.post('/api/books/add', (req, res) => {
    const books = readDB(BOOKS_FILE);
    books.push({ id: Date.now(), ...req.body });
    writeDB(BOOKS_FILE, books);
    res.status(201).json({ msg: "Success" });
});

app.delete('/api/books/:id', (req, res) => {
    const books = readDB(BOOKS_FILE).filter(b => b.id !== parseInt(req.params.id));
    writeDB(BOOKS_FILE, books);
    res.json({ msg: "Deleted" });
});

app.listen(5000, () => console.log("🚀 Charity Books Backend Active"));