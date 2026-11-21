import mongoose from 'mongoose';
import { BOOK_CATEGORIES } from '../lib/helpers.js';

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, trim: true },
    price: { type: Number, min: 0 },
    pages: { type: Number, min: 1 },
    description: { type: String, trim: true },
    category: {
      type: String,
      enum: BOOK_CATEGORIES,
      default: 'Other',
    },
    // Reviews live inside the book record, so they work the same way in
    // MongoDB and in the JSON-file fallback (books.json).
    reviews: { type: [reviewSchema], default: [] },
    // The user who added the book (set from the JWT on protected routes).
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Book', bookSchema);
