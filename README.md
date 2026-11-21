# bookbridge-backend

BookBridge backend — a small Express API for user auth and a book catalogue.

## What it does

- **Auth:** signup and login. Passwords are hashed with bcrypt; login returns
  a JWT (valid for 1 hour).
- **Books:** list, add, update and delete books, with search, categories,
  sorting and pagination.
- **Reviews & ratings:** users can rate books 1–5 stars and write a review;
  every book carries its `averageRating` and `reviewCount`.
- **Exchange requests:** users can request to borrow a book from its owner;
  the owner approves or rejects the request.
- **Wishlist:** users can save books to a personal wishlist.
- **Admin:** the user whose email matches `ADMIN_EMAIL` can list all users.
- **Storage:** MongoDB (via mongoose) when `MONGODB_URI` is set, otherwise
  the built-in JSON-file storage (`users.json` / `books.json` /
  `requests.json`), so the app runs with no database at all.
- **Tests:** `npm test` runs the unit tests (validation, rating maths,
  auth middleware) with Node's built-in test runner.

## Setup

```bash
npm install
cp .env.example .env   # then edit JWT_SECRET (and MONGODB_URI if you use MongoDB)
npm start              # or: npm run dev (nodemon)
npm test               # run the unit tests
```

The server listens on `PORT` (default `5000`).

## Environment variables

| Variable      | Required | Description                                                    |
| ------------- | -------- | -------------------------------------------------------------- |
| `PORT`        | No       | Port to listen on (default `5000`).                            |
| `JWT_SECRET`  | Yes      | Secret used to sign JWTs. Use a long random string.            |
| `MONGODB_URI` | No       | MongoDB connection string. Leave empty for JSON-file storage.  |
| `ADMIN_EMAIL` | No       | Email of the admin user (enables `GET /api/admin/users`). Leave empty to disable the admin endpoints. |

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

Book objects include `category`, `averageRating` and `reviewCount`.
Categories: `Fiction`, `Non-Fiction`, `Science`, `History`, `Technology`,
`Children`, `Other` (default: `Other`).

| Method | Route               | Auth | Description |
| ------ | ------------------- | ---- | ----------- |
| GET    | `/api/books`        | No   | List all books (plain array, as before). |
| GET    | `/api/books?q=&category=&sort=&page=&limit=` | No | Search by title/author (`q`), filter by `category`, sort by `sort` (`newest`, `price-asc`, `price-desc`, `rating`), paginated: `{ books, page, limit, total, totalPages }`. |
| POST   | `/api/books/add`    | Yes  | Add a book. `title` required; `price` / `pages` must be numbers if given; `category` must be one of the list above. → `201 { msg, book }` |
| PUT    | `/api/books/:id`    | Yes  | Update a book (only the fields you send, including `category`). → `200 { msg, book }` |
| DELETE | `/api/books/:id`    | Yes  | Delete a book. → `200 { msg: "Deleted" }` |

Example — add a book (protected):

```bash
curl -X POST http://localhost:5000/api/books/add \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Clean Code","author":"Robert C. Martin","price":45,"pages":464,"category":"Technology"}'
```

Example — search with pagination and sorting:

```bash
curl 'http://localhost:5000/api/books?q=clean&category=Technology&sort=rating&page=1&limit=5'
# => { "books": [ ... ], "page": 1, "limit": 5, "total": 1, "totalPages": 1 }
```

### Reviews

| Method | Route                    | Auth | Description |
| ------ | ------------------------ | ---- | ----------- |
| GET    | `/api/books/:id/reviews` | No   | All reviews of a book: `{ book, reviews, averageRating, reviewCount }`. |
| POST   | `/api/books/:id/reviews` | Yes  | Add (or update your own) review: `{ "rating" (1-5, required), "text"? }` → `201` (new) or `200` (updated) `{ msg, book, averageRating, reviewCount }`. |

### Exchange requests

| Method | Route                      | Auth | Description |
| ------ | -------------------------- | ---- | ----------- |
| POST   | `/api/books/:id/request`   | Yes  | Request to borrow a book: `{ "message"? }` → `201 { msg, request }`. You cannot request your own book, and only one pending request per book per user. |
| GET    | `/api/requests`            | Yes  | Requests you made + requests for books you own: `[{ id, book: { id, title, author }, requester, owner, status, message, createdAt }]`. |
| PUT    | `/api/requests/:id`        | Yes  | Book owner only: `{ "status": "approved" \| "rejected" }` → `200 { msg, request }`. A request that is no longer `pending` cannot be changed. |

### Wishlist

| Method | Route                        | Auth | Description |
| ------ | ---------------------------- | ---- | ----------- |
| POST   | `/api/books/:id/wishlist`    | Yes  | Toggle the book in your wishlist: `{ msg, wishlisted, wishlist }`. |
| GET    | `/api/users/me/wishlist`     | Yes  | Your wishlist as a list of books. |

### Admin

| Method | Route               | Auth | Description |
| ------ | ------------------- | ---- | ----------- |
| GET    | `/api/admin/users`  | Yes (admin only) | List all users. Only the user whose email matches `ADMIN_EMAIL` can call it (others get `403`). Password hashes are never returned. |

## Project structure

```
server.js                  # Express app: routes, storage switch (MongoDB / JSON files)
lib/helpers.js             # Shared helpers: validation, categories, rating maths
models/User.js             # Mongoose User schema (+ wishlist)
models/Book.js             # Mongoose Book schema (+ category, embedded reviews)
models/ExchangeRequest.js  # Mongoose ExchangeRequest schema
middleware/auth.js         # JWT auth middleware (protects add/update/delete)
tests/                     # Unit tests (node:test, no extra dependencies)
users.json                 # JSON-file user storage (used when MONGODB_URI is empty)
books.json                 # JSON-file book storage (used when MONGODB_URI is empty)
requests.json              # JSON-file exchange-request storage (used when MONGODB_URI is empty)
.env.example               # Copy to .env and fill in your secrets
LICENSE                    # MIT License
```

## License

MIT — see [LICENSE](LICENSE).
