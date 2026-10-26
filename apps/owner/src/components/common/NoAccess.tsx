import { Lock } from "lucide-react";
import { EmptyState } from "@/components/common/States";

// Shown instead of a screen the signed-in role is not allowed to use. The API refuses these
// requests too; this just explains why instead of showing an error.
export function NoAccess({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<Lock className="size-6" aria-hidden />}
      title="You do not have access to this"
      hint={`Your role cannot open ${what}. Ask a company owner or admin if you need it.`}
    />
  );
}
