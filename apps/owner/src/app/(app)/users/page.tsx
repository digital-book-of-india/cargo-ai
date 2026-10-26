"use client";

import { useMemo, useState } from "react";
import { Copy, Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { NoAccess } from "@/components/common/NoAccess";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert, ApiErrorState, EmptyState, LoadingState } from "@/components/common/States";
import { Badge, Button, Card, Checkbox, Modal, SelectField, TextField } from "@/components/ui";
import { useAsync } from "@/hooks/useAsync";
import { usersApi } from "@/lib/api/users";
import { friendlyMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_HINT, ROLE_LABEL, grantableRoles, needsSiteAssignment } from "@/lib/roles";
import { useSite } from "@/lib/site/SiteProvider";
import { canManageMember } from "@/types";
import type { CompanyMember, CompanyRole, InvitationResponse } from "@/types";

function SitePicker({
  sites,
  selected,
  onChange,
  disabled,
}: {
  sites: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  if (sites.length === 0) return <p className="text-sm text-muted-foreground">Create a site first, then assign it here.</p>;
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Sites this person can reach</legend>
      {sites.map((s) => {
        const id = `site-${s.id}`;
        const checked = selected.includes(s.id);
        return (
          <div key={s.id} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(v) => onChange(v === true ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
            />
            <label htmlFor={id} className="text-sm">
              {s.name}
            </label>
          </div>
        );
      })}
      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">With no site selected this person cannot see anything yet.</p>
      )}
    </fieldset>
  );
}

export default function UsersPage() {
  const { can, role, user } = useAuth();
  const { sites } = useSite();
  const members = useAsync<CompanyMember[]>(() => usersApi.list(), []);
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invited, setInvited] = useState<InvitationResponse | null>(null);
  const [editing, setEditing] = useState<CompanyMember | null>(null);
  const [toggling, setToggling] = useState<CompanyMember | null>(null);

  // invite form
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("SECURITY_OPERATOR");
  const [inviteSites, setInviteSites] = useState<string[]>([]);
  // edit form
  const [editRole, setEditRole] = useState<CompanyRole>("SECURITY_OPERATOR");
  const [editSites, setEditSites] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!can("users:read")) return <NoAccess what="the users and roles screen" />;
  if (members.loading && !members.data) return <LoadingState label="Loading people..." />;
  if (members.error && !members.data) return <ApiErrorState error={members.error} onRetry={members.reload} />;

  const roles = grantableRoles(role);
  const canManage = can("users:manage");
  const activeSites = sites.filter((s) => s.status === "ACTIVE");

  function openInvite() {
    setEmail("");
    setInviteRole(roles.includes("SECURITY_OPERATOR") ? "SECURITY_OPERATOR" : roles[0]);
    setInviteSites([]);
    setFormError(null);
    setInviteOpen(true);
  }

  async function sendInvite() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await usersApi.invite({
        email: email.trim(),
        role: inviteRole,
        siteIds: needsSiteAssignment(inviteRole) ? inviteSites : [],
      });
      setInviteOpen(false);
      setInvited(res);
      members.reload();
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(m: CompanyMember) {
    setEditing(m);
    setEditRole(m.role);
    setEditSites(m.siteIds);
    setFormError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setFormError(null);
    try {
      await usersApi.changeRole(editing.userId, {
        role: editRole,
        siteIds: needsSiteAssignment(editRole) ? editSites : [],
      });
      toast.success("Access updated");
      setEditing(null);
      members.reload();
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmToggle() {
    if (!toggling) return;
    setBusy(true);
    setFormError(null);
    try {
      await usersApi.setStatus(toggling.userId, toggling.status === "ACTIVE" ? "DISABLED" : "ACTIVE");
      toast.success(toggling.status === "ACTIVE" ? "Access turned off" : "Access turned on");
      setToggling(null);
      members.reload();
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const inviteLink = invited ? `${window.location.origin}/accept-invitation?token=${invited.token}` : "";

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Users and roles"
        description="Who can use your company's account, and what each person may do."
        actions={
          canManage ? (
            <Button onClick={openInvite} disabled={roles.length === 0}>
              <UserPlus aria-hidden /> Invite person
            </Button>
          ) : undefined
        }
      />

      {members.error && <Alert tone="warning">Could not refresh. This list may be out of date.</Alert>}

      {(members.data ?? []).length === 0 ? (
        <EmptyState title="No people yet" hint="Invite your colleagues and choose what each of them can do." />
      ) : (
        <Card>
          <ul className="divide-y" aria-label="People">
            {(members.data ?? []).map((m) => {
              const self = m.userId === user?.id;
              const manageable = canManage && !self && role !== null && canManageMember(role, m.role);
              const reach = !needsSiteAssignment(m.role)
                ? "All sites"
                : m.siteIds.length === 0
                ? "No sites assigned"
                : m.siteIds.map((id) => siteName.get(id) ?? "Unknown site").join(", ");
              return (
                <li key={m.userId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.name}</span>
                      {self && <Badge tone="neutral">You</Badge>}
                      <Badge tone={m.role === "COMPANY_OWNER" ? "primary" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                      {m.status === "DISABLED" && <Badge tone="danger">Access off</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{m.email}</p>
                    <p className="text-sm text-muted-foreground">{reach}</p>
                  </div>
                  {manageable && (
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(m)}>
                        Change access
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setFormError(null);
                          setToggling(m);
                        }}
                      >
                        {m.status === "ACTIVE" ? "Turn off" : "Turn on"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal
        open={inviteOpen}
        title="Invite a person"
        description="They get a one-time link. Email sending is not set up yet, so you pass the link on yourself."
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void sendInvite()} loading={busy} disabled={!email.trim()}>
              <Mail aria-hidden /> Create invitation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          <SelectField
            label="Role"
            value={inviteRole}
            onValueChange={(v) => setInviteRole(v as CompanyRole)}
            options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            hint={ROLE_HINT[inviteRole]}
            disabled={busy}
          />
          {needsSiteAssignment(inviteRole) && (
            <SitePicker sites={activeSites} selected={inviteSites} onChange={setInviteSites} disabled={busy} />
          )}
        </div>
      </Modal>

      <Modal
        open={!!invited}
        title="Invitation created"
        description="Send this link to the person. It works once and expires in 7 days."
        onClose={() => setInvited(null)}
        footer={<Button onClick={() => setInvited(null)}>Done</Button>}
      >
        {invited && (
          <div className="space-y-3">
            <p>
              For <strong>{invited.email}</strong> as <strong>{ROLE_LABEL[invited.role]}</strong>.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label="Invitation link"
                value={inviteLink}
                className="min-w-0 flex-1 rounded-lg border bg-muted px-3 py-2 text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteLink).then(
                    () => toast.success("Link copied"),
                    () => toast.error("Could not copy. Select the link and copy it by hand.")
                  );
                }}
              >
                <Copy aria-hidden /> Copy
              </Button>
            </div>
            <Alert tone="warning">This link is shown only once. Anyone who has it can join, so share it privately.</Alert>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editing}
        title={editing ? `Change access for ${editing.name}` : ""}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} loading={busy}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <SelectField
            label="Role"
            value={editRole}
            onValueChange={(v) => setEditRole(v as CompanyRole)}
            options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            hint={ROLE_HINT[editRole]}
            disabled={busy}
          />
          {needsSiteAssignment(editRole) && (
            <SitePicker sites={activeSites} selected={editSites} onChange={setEditSites} disabled={busy} />
          )}
        </div>
      </Modal>

      <Modal
        open={!!toggling}
        title={toggling?.status === "ACTIVE" ? "Turn off access?" : "Turn access back on?"}
        description={
          toggling
            ? toggling.status === "ACTIVE"
              ? `${toggling.name} will be signed out of your company straight away.`
              : `${toggling.name} will be able to use your company again.`
            : undefined
        }
        onClose={() => setToggling(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setToggling(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void confirmToggle()} loading={busy}>
              {toggling?.status === "ACTIVE" ? "Turn off" : "Turn on"}
            </Button>
          </>
        }
      >
        {formError && <Alert tone="danger">{formError}</Alert>}
      </Modal>
    </div>
  );
}
