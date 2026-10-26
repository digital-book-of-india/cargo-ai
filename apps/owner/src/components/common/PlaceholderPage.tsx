import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/common/States";
import { PageHeader } from "@/components/common/PageHeader";

// Honest stand-in for screens that are not built yet.
export function PlaceholderPage({
  title,
  description,
  phase,
}: {
  title: string;
  description?: string;
  phase: string;
}) {
  return (
    <div className="animate-fade-up">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Hammer className="size-6" aria-hidden />}
        title="This screen is not built yet"
        hint={`Planned for ${phase}.`}
      />
    </div>
  );
}
