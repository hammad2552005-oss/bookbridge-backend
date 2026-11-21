# bookbridge-backend

BookBridge backend — a small Express API for user auth and a book catalogue.

## What it does

- **Auth:** signup and login. Passwords are hashed with bcrypt; login returns
  a JWT (valid for 1 hour).
- **Books:** list, add, update and delete books, with search and pagination.
- **Storage:** MongoDB (via mongoose) when `MONGODB_URI` is set, otherwise
  the built-in JSON-file storage (`users.json` / `books.json`), so the app
  runs with no database at all.

## Setup

```bash
npm install
cp .env.example .env   # then edit JWT_SECRET (and MONGODB_URI if you use MongoDB)
npm start              # or: npm run dev (nodemon)
```

The server listens on `PORT` (default `5000`).

## Environment variables

| Variable      | Required | Description                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `PORT`        | No       | Port to listen on (default `5000`).                            |
| `JWT_SECRET`  | Yes      | Secret used to sign JWTs. Use a long random string.            |
| `MONGODB_URI` | No       | MongoDB connection string. Leave empty for JSON-file storage.  |

## API endpoints

All responses are JSON. Protected routes need the header
`Authorization: Bearer <token>` (token comes from login).

### Auth

| Method | Route              | Body / notes |
| ------ | ------------------ | ------------ |
| POST   | `/api/auth/signup` | `{ "fullName", "email", "password" (min 6 chars), "phone"? }` → `201 { msg, user }` |
| POST   | `/api/auth/login`  | `{ "email", "password" }` → `200 { user, token }` (token expires in 1h) |

Example — signup:

```bash
curl -X POST http://localhost:5000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Hammad Khan","email":"hammad@example.com","password":"secret123"}'
```

Example — login:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"hammad@example.com","password":"secret123"}'
# => { "user": { "id": 1, "fullName": "Hammad Khan", "email": "hammad@example.com" },
#      "token": "eyJhbGciOi..." }
```

> Users created before password hashing still have plain-text passwords in
> `users.json`. On their first successful login the password is automatically
> re-hashed with bcrypt and saved.

### Books

| Method | Route               | Auth | Description |
| ------ | ------------------- | ---- | ----------- |
| GET    | `/api/books`        | No   | List all books (plain array, as before). |
| GET    | `/api/books?q=&page=&limit=` | No | Search by title/author (`q`), paginated: `{ books, page, limit, total, totalPages }`. |
| POST   | `/api/books/add`    | Yes  | Add a book. `title` required; `price` / `pages` must be numbers if given. → `201 { msg, book }` |
| PUT    | `/api/books/:id`    | Yes  | Update a book (only the fields you send). → `200 { msg, book }` |
| DELETE | `/api/books/:id`    | Yes  | Delete a book. → `200 { msg: "Deleted" }` |

Example — add a book (protected):

```bash
curl -X POST http://localhost:5000/api/books/add \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Clean Code","author":"Robert C. Martin","price":45,"pages":464}'
```

Example — search with pagination:

```bash
curl 'http://localhost:5000/api/books?q=clean&page=1&limit=5'
# => { "books": [ ... ], "page": 1, "limit": 5, "total": 1, "totalPages": 1 }
```

## Project structure

```
server.js            # Express app: routes, storage switch (MongoDB / JSON files)
models/User.js       # Mongoose User schema
models/Book.js       # Mongoose Book schema
middleware/auth.js   # JWT auth middleware (protects add/update/delete)
users.json           # JSON-file user storage (used when MONGODB_URI is empty)
books.json           # JSON-file book storage (used when MONGODB_URI is empty)
.env.example         # Copy to .env and fill in your secrets
```
