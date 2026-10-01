import mongoose from 'mongoose';

const gameRecordSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: ['solo', 'online'],
    required: true,
    index: true
  },
  playerCount: {
    type: Number,
    min: 1,
    max: 4,
    required: true
  },
  winnerSeat: {
    type: Number,
    min: 0,
    max: 3,
    required: true
  },
  durationMs: {
    type: Number,
    min: 0,
    max: 6 * 60 * 60 * 1000,
    required: true
  },
  serverVerified: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  strict: 'throw',
  minimize: true
});

gameRecordSchema.index({ createdAt: -1 });
gameRecordSchema.index({ serverVerified: 1, createdAt: -1 });

export const GameRecord = mongoose.model('GameRecord', gameRecordSchema);
