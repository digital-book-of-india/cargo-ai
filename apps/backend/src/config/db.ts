import mongoose from "mongoose";
import { env } from "./env";
import dns from "node:dns";

// Some networks cannot resolve the SRV records of mongodb+srv:// addresses. Set DNS_SERVERS (for example
// "8.8.8.8,8.8.4.4") to use specific resolvers; by default the system resolvers are used.
const dnsServers = (process.env.DNS_SERVERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (dnsServers.length > 0) dns.setServers(dnsServers);

// In production indexes come from migrations (npm run migrate), not from every server start.
mongoose.set("autoIndex", !env.isProduction);

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



