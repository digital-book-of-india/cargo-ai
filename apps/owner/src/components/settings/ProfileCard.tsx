"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/common/States";
import { Button, Card, TextField } from "@/components/ui";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";

const MAX_NAME = 80;

// Only the name can be changed. The email is the sign-in identity and is shown read-only.
export function ProfileCard() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  if (!user) return null;
  const trimmed = name.trim();
  const dirty = trimmed !== user.name;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !dirty) return;
    setError(null);
    if (!trimmed) {
      setFieldError("Enter your name");
      return;
    }
    if (trimmed.length > MAX_NAME) {
      setFieldError(`Use ${MAX_NAME} characters or fewer`);
      return;
    }
    setFieldError(undefined);
    setSaving(true);
    try {
      const res = await authApi.updateProfile({ name: trimmed });
      if (res?.user?.id) updateUser(res.user);
      else updateUser({ ...user!, name: trimmed });
      setName(res?.user?.name ?? trimmed);
      toast.success("Profile saved");
    } catch (err) {
      const missing = err instanceof ApiError && [404, 405, 501].includes(err.status);
      setError(missing ? "Changing your name is not available yet." : friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Profile</h2>
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError}
          autoComplete="name"
          disabled={saving}
        />
        <TextField
          label="Email"
          value={user.email}
          disabled
          readOnly
          hint="This is how you sign in. It cannot be changed here."
        />
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}
