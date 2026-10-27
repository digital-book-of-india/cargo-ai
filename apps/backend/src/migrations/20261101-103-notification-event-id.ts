import type { Db } from "mongodb";
import type { Migration } from "./types";

// Notifications used to store the event id as text. It is now an ObjectId like every other reference, so the database
// can join notifications to events. Only values that are valid ids are converted: anything else is left untouched.
// `down` turns them back into text, so the change can be undone.
export const notificationEventIdAsObjectId: Migration = {
  id: "20261101-103-notification-event-id",
  description: "Notifications: store the event id as an ObjectId instead of text (reversible).",
  async up(db: Db) {
    await db.collection("notifications").updateMany(
      { eventId: { $type: "string", $regex: /^[a-fA-F0-9]{24}$/ } },
      [{ $set: { eventId: { $toObjectId: "$eventId" } } }]
    );
  },
  async down(db: Db) {
    await db.collection("notifications").updateMany({ eventId: { $type: "objectId" } }, [{ $set: { eventId: { $toString: "$eventId" } } }]);
  },
};
