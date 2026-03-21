"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useDevices } from "@/hooks/useDevices";
import { createBrowserClient } from "@/lib/supabase/client";
import type { Scene, SceneAction, DeviceId } from "@clever/shared";

/**
 * Scene management page.
 * Create, edit, and activate scenes (multi-device presets).
 * Each scene contains a list of device actions that execute together.
 */
export default function ScenesPage() {
  const { tenantId, user } = useAuth();
  const { devices } = useDevices(tenantId);
  const supabase = createBrowserClient();

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  /** Form state for new/edit scene */
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTrigger, setFormTrigger] = useState<Scene["trigger"]>("manual");
  const [formActions, setFormActions] = useState<SceneAction[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Fetch scenes */
  const fetchScenes = useCallback(async () => {
    if (!tenantId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from("scenes")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("name");

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setScenes((data as unknown as Scene[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch scenes");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase]);

  useEffect(() => {
    void fetchScenes();
  }, [fetchScenes]);

  /** Activate a scene */
  const activateScene = async (scene: Scene) => {
    setActivatingId(scene.id);
    try {
      /** Execute each action in the scene */
      for (const action of scene.actions) {
        await supabase.from("device_commands").insert({
          device_id: action.device_id,
          tenant_id: tenantId,
          action: action.action,
          parameters: action.parameters,
          source: "dashboard",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate scene");
    } finally {
      setActivatingId(null);
    }
  };

  /** Add action to form */
  const addAction = () => {
    if (devices.length === 0) return;
    const firstDevice = devices[0];
    if (!firstDevice) return;

    setFormActions((prev) => [
      ...prev,
      {
        device_id: firstDevice.id,
        action: "turn_on",
        parameters: {},
      },
    ]);
  };

  /** Remove action from form */
  const removeAction = (index: number) => {
    setFormActions((prev) => prev.filter((_, i) => i !== index));
  };

  /** Update an action */
  const updateAction = (index: number, field: keyof SceneAction, value: unknown) => {
    setFormActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, [field]: value } : a))
    );
  };

  /** Save scene (create or update) */
  const saveScene = async () => {
    if (!tenantId || !user || !formName.trim()) return;

    try {
      const sceneData = {
        tenant_id: tenantId,
        name: formName.trim(),
        description: formDescription.trim(),
        actions: formActions,
        trigger: formTrigger,
        created_by: user.id,
      };

      if (editingId) {
        const { error: updateError } = await supabase
          .from("scenes")
          .update(sceneData)
          .eq("id", editingId);

        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: insertError } = await supabase
          .from("scenes")
          .insert(sceneData);

        if (insertError) throw new Error(insertError.message);
      }

      resetForm();
      await fetchScenes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scene");
    }
  };

  /** Delete scene */
  const deleteScene = async (sceneId: string) => {
    if (!confirm("Are you sure you want to delete this scene?")) return;

    const { error: deleteError } = await supabase
      .from("scenes")
      .delete()
      .eq("id", sceneId);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      await fetchScenes();
    }
  };

  /** Start editing a scene */
  const startEditing = (scene: Scene) => {
    setEditingId(scene.id);
    setFormName(scene.name);
    setFormDescription(scene.description);
    setFormTrigger(scene.trigger);
    setFormActions(scene.actions);
    setShowCreateForm(true);
  };

  /** Reset form */
  const resetForm = () => {
    setShowCreateForm(false);
    setEditingId(null);
    setFormName("");
    setFormDescription("");
    setFormTrigger("manual");
    setFormActions([]);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Scenes</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-5 w-32 rounded bg-slate-200" />
              <div className="mt-2 h-4 w-48 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Scenes</h2>
          <p className="mt-1 text-sm text-slate-500">
            Create multi-device presets for one-tap activation
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowCreateForm(true);
          }}
          className="btn-primary"
        >
          Create Scene
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

      {/* Create/Edit Form */}
      {showCreateForm && (
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">
            {editingId ? "Edit Scene" : "New Scene"}
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Scene Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Movie Night"
                  className="input-field"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Trigger
                </label>
                <select
                  value={formTrigger ?? "manual"}
                  onChange={(e) =>
                    setFormTrigger(e.target.value as Scene["trigger"])
                  }
                  className="input-field"
                >
                  <option value="manual">Manual</option>
                  <option value="voice">Voice</option>
                  <option value="schedule">Schedule</option>
                  <option value="geofence">Geofence</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Description
              </label>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe what this scene does..."
                rows={2}
                className="input-field"
              />
            </div>

            {/* Actions */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Actions ({formActions.length})
                </label>
                <button
                  type="button"
                  onClick={addAction}
                  className="btn-secondary text-xs"
                >
                  Add Action
                </button>
              </div>
              <div className="space-y-2">
                {formActions.map((action, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-lg bg-slate-50 p-3"
                  >
                    <select
                      value={action.device_id as string}
                      onChange={(e) =>
                        updateAction(
                          idx,
                          "device_id",
                          e.target.value as unknown as DeviceId
                        )
                      }
                      className="input-field flex-1"
                    >
                      {devices.map((d) => (
                        <option key={d.id} value={d.id as string}>
                          {d.name} ({d.room})
                        </option>
                      ))}
                    </select>
                    <select
                      value={action.action}
                      onChange={(e) => updateAction(idx, "action", e.target.value)}
                      className="input-field w-40"
                    >
                      <option value="turn_on">Turn On</option>
                      <option value="turn_off">Turn Off</option>
                      <option value="locked">Lock</option>
                      <option value="unlocked">Unlock</option>
                      <option value="toggle">Toggle</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeAction(idx)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {formActions.length === 0 && (
                  <p className="rounded-lg border-2 border-dashed border-slate-200 py-6 text-center text-sm text-slate-400">
                    No actions yet. Add devices to this scene.
                  </p>
                )}
              </div>
            </div>

            {/* Form buttons */}
            <div className="flex gap-3">
              <button
                onClick={saveScene}
                disabled={!formName.trim() || formActions.length === 0}
                className="btn-primary"
              >
                {editingId ? "Update Scene" : "Create Scene"}
              </button>
              <button onClick={resetForm} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scene list */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {scenes.map((scene) => (
          <div key={scene.id} className="card">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{scene.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{scene.description}</p>
              </div>
              {scene.trigger && (
                <span className="badge-info">{scene.trigger}</span>
              )}
            </div>

            <p className="text-xs text-slate-400">
              {scene.actions.length} action{scene.actions.length !== 1 ? "s" : ""}
            </p>

            {/* Action summary */}
            <div className="mt-2 space-y-1">
              {scene.actions.slice(0, 3).map((action, idx) => {
                const device = devices.find((d) => d.id === action.device_id);
                return (
                  <p key={idx} className="text-xs text-slate-500">
                    {device?.name ?? String(action.device_id)} &rarr; {action.action}
                  </p>
                );
              })}
              {scene.actions.length > 3 && (
                <p className="text-xs text-slate-400">
                  +{scene.actions.length - 3} more
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => activateScene(scene)}
                disabled={activatingId === scene.id}
                className="btn-primary flex-1 text-xs"
              >
                {activatingId === scene.id ? "Activating..." : "Activate"}
              </button>
              <button
                onClick={() => startEditing(scene)}
                className="btn-secondary text-xs"
              >
                Edit
              </button>
              <button
                onClick={() => deleteScene(scene.id)}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {scenes.length === 0 && !showCreateForm && (
          <div className="col-span-full flex flex-col items-center rounded-xl border-2 border-dashed border-slate-200 py-16">
            <p className="text-sm text-slate-500">No scenes created yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Scenes let you control multiple devices with a single tap or voice command
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="btn-primary mt-4 text-sm"
            >
              Create your first scene
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
