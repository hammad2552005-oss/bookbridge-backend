import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Stored as a bcrypt hash. Never store a plain-text password.
    password: { type: String, required: true },
    phone: { type: String, trim: true },
    // Books the user saved for later (array of Book ids).
    wishlist: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
