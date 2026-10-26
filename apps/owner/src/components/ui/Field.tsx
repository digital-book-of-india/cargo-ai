"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Label } from "./Label";

// Plain styled input (shadcn Input).
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm",
          "transition-colors placeholder:text-muted-foreground/70",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70",
          "aria-[invalid=true]:border-destructive",
          className
        )}
        {...props}
      />
    );
  }
);

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

// Label + control + hint/error, wired for screen readers.
export function FormField({ id, label, error, hint, children, className }: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

// Labelled input. Password inputs get a show/hide toggle.
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, id, type, className, ...props },
  ref
) {
  const autoId = React.useId();
  const fieldId = id ?? autoId;
  const [shown, setShown] = React.useState(false);
  const isPassword = type === "password";

  return (
    <FormField id={fieldId} label={label} error={error} hint={hint}>
      <div className="relative">
        <Input
          ref={ref}
          id={fieldId}
          type={isPassword && shown ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(isPassword && "pr-10", className)}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
          >
            {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        )}
      </div>
    </FormField>
  );
});
