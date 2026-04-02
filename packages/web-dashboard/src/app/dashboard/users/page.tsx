"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type { User, UserRole } from "@clever/shared";

/**
 * User management page (admin only).
 * Invite new users, assign roles, and deactivate accounts.
 * Only accessible to users with admin or owner role.
 */
export default function UsersPage() {
  const { tenantId, canManageUsers, isOwner } = useAuth();
  const supabase = createBrowserClient();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  /** Invite form state */
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDisplayName, setInviteDisplayName] = useState("");
  const [inviteRole, setInviteRole] = useState<UserRole>("resident");
  const [inviteLoading, setInviteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from("users_decrypted")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setUsers((data as unknown as User[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  /** Send invite - creates auth user and profile */
  const handleInvite = async () => {
    if (!tenantId || !inviteEmail.trim()) return;

    setInviteLoading(true);
    setError(null);

    try {
      /** Create auth user with a random password (they'll reset it) */
      const tempPassword = crypto.randomUUID();
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: inviteEmail,
        password: tempPassword,
        email_confirm: false,
        user_metadata: { display_name: inviteDisplayName },
      });

      if (authError) {
        /** Fallback: invite via magic link if admin API is unavailable */
        const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(inviteEmail);
        if (inviteError) {
          setError(`Failed to invite user: ${inviteError.message}`);
          return;
        }
      }

      /** Create the user profile */
      const userId = authData?.user?.id;
      if (userId) {
        const { error: profileError } = await supabase.from("users").insert({
          id: userId,
          tenant_id: tenantId,
          email: inviteEmail,
          role: inviteRole,
          display_name: inviteDisplayName || inviteEmail.split("@")[0],
        });

        if (profileError) {
          setError(`User created but profile failed: ${profileError.message}`);
          return;
        }
      }

      /** Reset form and refresh */
      setShowInviteForm(false);
      setInviteEmail("");
      setInviteDisplayName("");
      setInviteRole("resident");
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite user");
    } finally {
      setInviteLoading(false);
    }
  };

  /** Update user role */
  const updateUserRole = async (userId: string, newRole: UserRole) => {
    const { error: updateError } = await supabase
      .from("users")
      .update({ role: newRole })
      .eq("id", userId);

    if (updateError) {
      setError(updateError.message);
    } else {
      await fetchUsers();
    }
  };

  /** Deactivate user */
  const deactivateUser = async (userId: string, displayName: string) => {
    if (
      !confirm(
        `Are you sure you want to deactivate ${displayName}? They will lose access immediately.`
      )
    ) {
      return;
    }

    try {
      /** Remove from users table (cascade will handle related data) */
      const { error: deleteError } = await supabase
        .from("users")
        .delete()
        .eq("id", userId);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate user");
    }
  };

  if (!canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-semibold text-slate-900">Access Denied</p>
        <p className="mt-1 text-sm text-slate-500">
          You need admin or owner access to manage users.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Users</h2>
        <div className="card animate-pulse">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const roleOptions: { value: UserRole; label: string }[] = [
    { value: "owner", label: "Owner" },
    { value: "admin", label: "Admin" },
    { value: "manager", label: "Manager" },
    { value: "resident", label: "Resident" },
    { value: "guest", label: "Guest" },
  ];

  /** Only owners can create admin/owner users */
  const availableRoles = isOwner
    ? roleOptions
    : roleOptions.filter((r) => r.value !== "owner" && r.value !== "admin");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Users</h2>
          <p className="mt-1 text-sm text-slate-500">
            {users.length} user{users.length !== 1 ? "s" : ""} in this property
          </p>
        </div>
        <button
          onClick={() => setShowInviteForm(true)}
          className="btn-primary"
        >
          Invite User
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Invite Form */}
      {showInviteForm && (
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">
            Invite New User
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="input-field"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Display Name
              </label>
              <input
                type="text"
                value={inviteDisplayName}
                onChange={(e) => setInviteDisplayName(e.target.value)}
                placeholder="Jane Smith"
                className="input-field"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="input-field"
              >
                {availableRoles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviteLoading}
              className="btn-primary"
            >
              {inviteLoading ? "Sending invite..." : "Send Invite"}
            </button>
            <button
              onClick={() => setShowInviteForm(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Joined</th>
                <th className="px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                        {u.display_name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {u.display_name}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={u.role}
                      onChange={(e) =>
                        updateUserRole(u.id as string, e.target.value as UserRole)
                      }
                      disabled={u.role === "owner" && !isOwner}
                      className="input-field w-auto text-sm"
                    >
                      {roleOptions.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    {u.role !== "owner" && (
                      <button
                        onClick={() =>
                          deactivateUser(u.id as string, u.display_name)
                        }
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
