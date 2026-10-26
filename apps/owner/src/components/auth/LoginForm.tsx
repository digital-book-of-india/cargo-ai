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
import { loginSchema } from "@/lib/validation";

export function LoginForm() {
  const { login } = useAuth();
  const params = useSearchParams();
  const next = params.get("next");
  const expired = params.get("reason") === "expired";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const parsed = loginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await login(parsed.data);
    } catch (err) {
      setFormError(friendlyMessage(err));
      setSubmitting(false);
    }
  }

  const registerHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-base text-muted-foreground">Sign in to check your site&apos;s monitoring status.</p>
      </div>

      {expired && <Alert tone="warning">Your session expired. Please sign in again.</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}

      <div className="space-y-5">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@yoursite.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          className="h-12 text-base"
          disabled={submitting}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          className="h-12 text-base"
          disabled={submitting}
        />
      </div>

      <Button type="submit" size="lg" loading={submitting} className="w-full">
        Sign in
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New to DBI Intelligence?{" "}
        <Link href={registerHref} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>

    </form>
  );
}
