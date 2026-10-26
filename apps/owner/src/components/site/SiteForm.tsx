"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/common/States";
import { Button, SelectField, TextField } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { zodFieldErrors } from "@/lib/utils/forms";
import { DEFAULT_TIMEZONE, getTimezoneOptions, isValidTimezone } from "@/lib/utils/timezones";
import { createSiteSchema } from "@/lib/validation";
import type { Site } from "@/types";

export interface SiteFormValues {
  name: string;
  code: string;
  timezone: string;
  address: { city?: string; state?: string; postalCode?: string };
}

interface SiteFormProps {
  initial?: Site;
  submitLabel: string;
  onSubmit: (values: SiteFormValues) => Promise<void>;
  onCancel?: () => void;
  /** edit mode keeps Save disabled until something changed */
  requireChange?: boolean;
  /** show the details without the ability to change them */
  readOnly?: boolean;
}

export function SiteForm({ initial, submitLabel, onSubmit, onCancel, requireChange, readOnly }: SiteFormProps) {
  const start = {
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    timezone: initial?.timezone ?? DEFAULT_TIMEZONE,
    city: initial?.address?.city ?? "",
    state: initial?.address?.state ?? "",
    postalCode: initial?.address?.postalCode ?? "",
  };

  const [name, setName] = useState(start.name);
  const [code, setCode] = useState(start.code);
  const [timezone, setTimezone] = useState(start.timezone);
  const [city, setCity] = useState(start.city);
  const [state, setState] = useState(start.state);
  const [postalCode, setPostalCode] = useState(start.postalCode);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const timezones = useMemo(() => getTimezoneOptions(initial?.timezone), [initial?.timezone]);

  const dirty =
    name !== start.name ||
    code !== start.code ||
    timezone !== start.timezone ||
    city !== start.city ||
    state !== start.state ||
    postalCode !== start.postalCode;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const address = {
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
    };
    const parsed = createSiteSchema.safeParse({ name, code, timezone, address });
    const fieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (!fieldErrors.timezone && !isValidTimezone(timezone)) {
      fieldErrors.timezone = "Choose a valid timezone";
    }
    if (!parsed.success || Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), code: code.trim(), timezone, address });
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="danger">{formError}</Alert>}

      <TextField
        label="Site name"
        placeholder="North Warehouse"
        autoComplete="organization"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        disabled={submitting || readOnly}
      />

      <TextField
        label="Site code"
        hint="A short unique code for this site within your company, for example WH-NORTH."
        placeholder="WH-NORTH"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={errors.code}
        disabled={submitting || readOnly}
      />

      <SelectField
        label="Timezone"
        hint="Times in alerts follow this timezone."
        value={timezone}
        onValueChange={setTimezone}
        options={timezones}
        error={errors.timezone}
        disabled={submitting || readOnly}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="City"
          autoComplete="address-level2"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={submitting || readOnly}
        />
        <TextField
          label="State"
          autoComplete="address-level1"
          value={state}
          onChange={(e) => setState(e.target.value)}
          disabled={submitting || readOnly}
        />
        <TextField
          label="Postal code"
          autoComplete="postal-code"
          inputMode="numeric"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          disabled={submitting || readOnly}
        />
      </div>

      {!readOnly && (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting || readOnly}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={submitting} disabled={requireChange && !dirty}>
          {submitLabel}
        </Button>
      </div>
      )}
    </form>
  );
}
