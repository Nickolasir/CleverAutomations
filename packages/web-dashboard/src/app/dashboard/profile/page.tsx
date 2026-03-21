"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const { user, role, tenant } = useAuth();
  const supabase = createBrowserClient();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpdateProfile = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: updateError } = await supabase
        .from("users")
        .update({ display_name: displayName })
        .eq("id", user.id as string);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess("Profile updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);

    try {
      const { error: pwError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (pwError) {
        setError(pwError.message);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password changed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = role
    ? role.charAt(0).toUpperCase() + role.slice(1)
    : "Unknown";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Profile</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account settings
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Account Info */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Account Information
        </h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSuccess(null);
              }}
              className="input-field max-w-md"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </label>
            <p className="text-sm text-slate-900">{user?.email}</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Role
            </label>
            <p className="text-sm text-slate-900">{roleLabel}</p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Property
            </label>
            <p className="text-sm text-slate-900">{tenant?.name ?? "—"}</p>
          </div>

          <button
            onClick={handleUpdateProfile}
            disabled={saving || displayName === user?.display_name}
            className="btn-primary"
          >
            {saving ? "Saving..." : "Update Profile"}
          </button>
        </div>
      </section>

      {/* Change Password */}
      <section className="card">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Change Password
        </h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setSuccess(null);
              }}
              placeholder="Min 8 characters"
              minLength={8}
              autoComplete="new-password"
              className="input-field max-w-md"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setSuccess(null);
              }}
              placeholder="Repeat new password"
              minLength={8}
              autoComplete="new-password"
              className="input-field max-w-md"
            />
          </div>

          <button
            onClick={handleChangePassword}
            disabled={saving || !newPassword || !confirmPassword}
            className="btn-primary"
          >
            {saving ? "Changing..." : "Change Password"}
          </button>
        </div>
      </section>
    </div>
  );
}
