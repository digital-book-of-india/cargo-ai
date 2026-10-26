import mongoose from "mongoose";
import { env } from "./env";
import dns from "node:dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

export async function connectDatabase(): Promise<void> {
  try {
    mongoose.connection.on("connected", () => {
      console.log("Connected to MongoDB successfully");
    });

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB disconnected");
    });

    await mongoose.connect(env.mongodbUri);
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
