import mongoose, { Schema, Document } from "mongoose";

export interface IAiWorkerHealthDocument extends Document {
  workerId: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  activeStreams: number;
  lastHeartbeatAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const aiWorkerHealthSchema = new Schema<IAiWorkerHealthDocument>(
  {
    workerId: { type: String, default: "default-worker", unique: true },
    status: { type: String, enum: ["ONLINE", "DEGRADED", "OFFLINE"], default: "ONLINE" },
    activeStreams: { type: Number, default: 1 },
    lastHeartbeatAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const AiWorkerHealthModel =
  mongoose.models.AiWorkerHealth ||
  mongoose.model<IAiWorkerHealthDocument>("AiWorkerHealth", aiWorkerHealthSchema);
