"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/common/States";
import { Button, TextField } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { zodFieldErrors } from "@/lib/utils/forms";
import { registerSchema } from "@/lib/validation";

export function RegisterForm() {
  const { register } = useAuth();
  const params = useSearchParams();
  const next = params.get("next");

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const parsed = registerSchema.safeParse({ name, email: email.trim(), password, companyName: companyName.trim() || undefined });
    const fieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (password !== confirm) fieldErrors.confirm = "Passwords do not match";
    if (!parsed.success || fieldErrors.confirm) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await register(parsed.data); // RedirectIfAuthed then moves the user on
    } catch (err) {
      setFormError(friendlyMessage(err));
      setSubmitting(false);
    }
  }

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Set up your company and its warehouses.
        </p>
      </div>

      {formError && <Alert tone="danger">{formError}</Alert>}

      <div className="space-y-4">
        <TextField
          label="Full name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          disabled={submitting}
        />
        <TextField
          label="Company name"
          hint="Your company's name. You can change it later."
          autoComplete="organization"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          error={errors.companyName}
          disabled={submitting}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@yoursite.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          disabled={submitting}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          disabled={submitting}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          disabled={submitting}
        />
      </div>

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={loginHref} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
