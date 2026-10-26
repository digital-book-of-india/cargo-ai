import { notFound } from "next/navigation";
import { Preview } from "./Preview";

// Developer-only page that shows every shared UI primitive. Hidden in production.
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Preview />;
}
