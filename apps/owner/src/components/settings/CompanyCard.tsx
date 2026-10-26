"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, ApiErrorState, LoadingState } from "@/components/common/States";
import { Button, Card, SelectField, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { companyApi } from "@/lib/api/company";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_LABEL } from "@/lib/roles";
import { getTimezoneOptions } from "@/lib/utils/timezones";

export function CompanyCard() {
  const { can, role } = useAuth();
  const company = useAsync(async () => (await companyApi.get()).company, []);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = can("company:update");

  useEffect(() => {
    if (company.data) {
      setName(company.data.name);
      setTimezone(company.data.timezone);
    }
  }, [company.data]);

  if (company.loading && !company.data) return <Card className="p-5"><LoadingState label="Loading company..." /></Card>;
  if (company.error && !company.data) return <ApiErrorState error={company.error} onRetry={company.reload} />;
  if (!company.data) return null;

  const dirty = name.trim() !== company.data.name || timezone !== company.data.timezone;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await companyApi.update({ name: name.trim(), timezone });
      toast.success("Company updated");
      company.reload();
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Company</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {role ? `You are signed in as ${ROLE_LABEL[role].toLowerCase()}.` : ""}
        {editable ? "" : " Only owners and admins can change these details."}
      </p>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="mt-4 space-y-4">
        <TextField label="Company name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable || saving} />
        <SelectField
          label="Company time zone"
          hint="The default for new sites and for reports."
          value={timezone}
          onValueChange={setTimezone}
          options={getTimezoneOptions(company.data.timezone)}
          disabled={!editable || saving}
        />
      </div>
      {editable && (
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty || !name.trim()}>
            Save company
          </Button>
        </div>
      )}
    </Card>
  );
}
