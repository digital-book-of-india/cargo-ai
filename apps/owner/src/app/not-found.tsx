import Link from "next/link";
import { EmptyState } from "@/components/common/States";
import { Button } from "@/components/ui";

export const metadata = { title: "Page not found | CargoSense AI" };

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        title="Page not found"
        hint="The page you are looking for does not exist or has moved."
        action={
          <Button asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        }
      />
    </main>
  );
}
