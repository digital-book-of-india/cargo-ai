import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface IEventNoteDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  eventId: Types.ObjectId;
  authorUserId: Types.ObjectId;
  note: string;
  createdAt: Date;
}

const eventNoteSchema = new Schema<IEventNoteDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "CargoEvent", required: true },
    authorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, required: true, minlength: 1, maxlength: 5000 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "cargo_event_notes" }
);

eventNoteSchema.index({ companyId: 1, eventId: 1, createdAt: 1 });

export const EventNoteModel =
  (mongoose.models.EventNote as mongoose.Model<IEventNoteDocument>) ||
  model<IEventNoteDocument>("EventNote", eventNoteSchema);
