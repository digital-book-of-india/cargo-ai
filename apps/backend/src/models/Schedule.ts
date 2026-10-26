import mongoose, { Schema, model, Document, Types } from "mongoose";
import { DaySchedule, ScheduleException } from "@dbi/api-types";

export interface IScheduleDocument extends Document {
  _id: Types.ObjectId;
  shopId: Types.ObjectId;
  weeklySchedule: DaySchedule[];
  gracePeriodMinutes: number;
  exceptions: ScheduleException[];
  version: number;
  updatedAt: Date;
}

const dayScheduleSchema = new Schema(
  {
    day: {
      type: String,
      enum: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      required: true,
    },
    openTime: { type: String },
    closeTime: { type: String },
    closed: { type: Boolean, default: false },
    closesNextDay: { type: Boolean, default: false },
  },
  { _id: false }
);

const exceptionSchema = new Schema(
  {
    date: { type: String, required: true },
    closed: { type: Boolean, default: false },
    openTime: { type: String },
    closeTime: { type: String },
    closesNextDay: { type: Boolean, default: false },
    note: { type: String },
  },
  { _id: false }
);

const scheduleSchema = new Schema<IScheduleDocument>(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, unique: true, index: true },
    weeklySchedule: { type: [dayScheduleSchema], required: true },
    gracePeriodMinutes: { type: Number, min: 0, max: 60, default: 5 },
    exceptions: { type: [exceptionSchema], default: [] },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
  }
);

export const ScheduleModel =
  (mongoose.models.Schedule as mongoose.Model<IScheduleDocument>) ||
  model<IScheduleDocument>("Schedule", scheduleSchema);

