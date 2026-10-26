"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/common/States";
import { Button, SelectField, TextField } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { zodFieldErrors } from "@/lib/utils/forms";
import { DEFAULT_TIMEZONE, getTimezoneOptions, isValidTimezone } from "@/lib/utils/timezones";
import { shopSchema } from "@/lib/validation";
import type { Shop } from "@/types";

export interface ShopFormValues {
  name: string;
  timezone: string;
  address: { city?: string; state?: string; postalCode?: string };
}

interface ShopFormProps {
  initial?: Shop;
  submitLabel: string;
  onSubmit: (values: ShopFormValues) => Promise<void>;
  onCancel?: () => void;
  /** edit mode keeps Save disabled until something changed */
  requireChange?: boolean;
}

export function ShopForm({ initial, submitLabel, onSubmit, onCancel, requireChange }: ShopFormProps) {
  const start = {
    name: initial?.name ?? "",
    timezone: initial?.timezone ?? DEFAULT_TIMEZONE,
    city: initial?.address?.city ?? "",
    state: initial?.address?.state ?? "",
    postalCode: initial?.address?.postalCode ?? "",
  };

  const [name, setName] = useState(start.name);
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
    const parsed = shopSchema.safeParse({ name, timezone, address });
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
      await onSubmit({ name: name.trim(), timezone, address });
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
        label="Shop name"
        placeholder="Main Street Shop"
        autoComplete="organization"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        disabled={submitting}
      />

      <SelectField
        label="Timezone"
        hint="Times in alerts follow this timezone."
        value={timezone}
        onValueChange={setTimezone}
        options={timezones}
        error={errors.timezone}
        disabled={submitting}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="City"
          autoComplete="address-level2"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={submitting}
        />
        <TextField
          label="State"
          autoComplete="address-level1"
          value={state}
          onChange={(e) => setState(e.target.value)}
          disabled={submitting}
        />
        <TextField
          label="Postal code"
          autoComplete="postal-code"
          inputMode="numeric"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={submitting} disabled={requireChange && !dirty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
