"use client";

import { Suspense, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/common/States";
import { Button, TextField } from "@/components/ui";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";

function AcceptForm() {
  const { acceptInvitation } = useAuth();
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Invitation link needed</h1>
        <Alert tone="warning">This page needs the link you were sent. Ask the person who invited you to send it again.</Alert>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Enter your name";
    if (password.length < 8) next.password = "Use at least 8 characters";
    if (password !== confirm) next.confirm = "Passwords do not match";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await acceptInvitation({ token, name: name.trim(), password });
      router.replace("/dashboard");
    } catch (err) {
      setFormError(friendlyMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Join your company</h1>
        <p className="text-sm text-muted-foreground">
          Choose your name and a password. If you already have an account with this email, enter your existing password.
        </p>
      </div>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="space-y-4">
        <TextField label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} disabled={submitting} />
        <TextField label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} disabled={submitting} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} disabled={submitting} />
      </div>
      <Button type="submit" className="w-full" loading={submitting}>
        Join
      </Button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptForm />
    </Suspense>
  );
}
