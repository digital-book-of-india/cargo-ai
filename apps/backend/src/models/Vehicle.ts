import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface IVehicleDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  registrationNumber: string; // stored upper-case without surrounding spaces
  label?: string | null;
  active: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

const vehicleSchema = new Schema<IVehicleDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    registrationNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    label: { type: String, trim: true, maxlength: 120, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "cargo_vehicles" }
);

vehicleSchema.index({ companyId: 1, registrationNumber: 1 }, { unique: true });

export const VehicleModel =
  (mongoose.models.Vehicle as mongoose.Model<IVehicleDocument>) || model<IVehicleDocument>("Vehicle", vehicleSchema);
