import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, trim: true },
    price: { type: Number, min: 0 },
    pages: { type: Number, min: 1 },
    description: { type: String, trim: true },
    // The user who added the book (set from the JWT on protected routes).
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Book', bookSchema);
