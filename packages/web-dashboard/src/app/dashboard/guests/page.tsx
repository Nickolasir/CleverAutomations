"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createBrowserClient } from "@/lib/supabase/client";
import type {
  Reservation,
  GuestProfile,
  GuestWipeChecklist,
  GuestWipeCategory,
  REQUIRED_WIPE_CATEGORIES,
  TurnoverTask,
} from "@clever/shared";

type ReservationStatus = Reservation["status"];

/**
 * CleverHost guest management page.
 * Features: reservation calendar, guest profiles, turnover checklist,
 * and wipe status tracking. Only shown for CleverHost vertical.
 */
export default function GuestsPage() {
  const { tenantId, tenant } = useAuth();
  const supabase = createBrowserClient();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [guestProfile, setGuestProfile] = useState<GuestProfile | null>(null);
  const [wipeChecklist, setWipeChecklist] = useState<GuestWipeChecklist | null>(null);
  const [turnoverTasks, setTurnoverTasks] = useState<TurnoverTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "all">("all");

  /** Fetch reservations */
  const fetchReservations = useCallback(async () => {
    if (!tenantId) return;

    try {
      let query = supabase
        .from("reservations")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("check_in", { ascending: true });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setReservations((data as unknown as Reservation[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch reservations");
    } finally {
      setLoading(false);
    }
  }, [tenantId, supabase, statusFilter]);

  useEffect(() => {
    void fetchReservations();
  }, [fetchReservations]);

  /** Load guest profile and wipe status for a reservation */
  const loadReservationDetails = async (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setGuestProfile(null);
    setWipeChecklist(null);

    const [profileRes, wipeRes, turnoverRes] = await Promise.all([
      supabase
        .from("guest_profiles")
        .select("*")
        .eq("reservation_id", reservation.id as string)
        .single(),
      supabase
        .from("guest_wipe_checklists")
        .select("*")
        .eq("reservation_id", reservation.id as string)
        .single(),
      supabase
        .from("turnover_tasks")
        .select("*")
        .eq("reservation_id", reservation.id as string)
        .order("created_at"),
    ]);

    if (profileRes.data) {
      setGuestProfile(profileRes.data as unknown as GuestProfile);
    }
    if (wipeRes.data) {
      setWipeChecklist(wipeRes.data as unknown as GuestWipeChecklist);
    }
    if (turnoverRes.data) {
      setTurnoverTasks(turnoverRes.data as unknown as TurnoverTask[]);
    }
  };

  /** Initiate guest wipe for a completed reservation */
  const initiateWipe = async (reservationId: string) => {
    if (!tenantId) return;

    try {
      const wipeCategories: GuestWipeCategory[] = [
        "locks",
        "wifi",
        "voice_history",
        "tv_logins",
        "preferences",
        "personal_data",
      ];

      const { error: insertError } = await supabase
        .from("guest_wipe_checklists")
        .insert({
          reservation_id: reservationId,
          tenant_id: tenantId,
          items: wipeCategories.map((category) => ({
            category,
            description: `Wipe ${category.replace("_", " ")}`,
            status: "pending",
            completed_at: null,
          })),
          started_at: new Date().toISOString(),
          completed_at: null,
          is_complete: false,
        });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      /** Also create a turnover task */
      await supabase.from("turnover_tasks").insert({
        tenant_id: tenantId,
        reservation_id: reservationId,
        type: "wipe",
        status: "pending",
        assigned_devices: [],
        created_at: new Date().toISOString(),
        completed_at: null,
      });

      /** Refresh the selected reservation details */
      if (selectedReservation?.id === reservationId) {
        await loadReservationDetails(selectedReservation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate wipe");
    }
  };

  /** Get status badge classes */
  const statusBadge = (status: ReservationStatus): string => {
    switch (status) {
      case "upcoming":
        return "badge-info";
      case "active":
        return "badge-success";
      case "completed":
        return "badge-neutral";
      case "cancelled":
        return "badge-error";
      default:
        return "badge-neutral";
    }
  };

  const wipeCategoryLabel = (category: GuestWipeCategory): string => {
    const labels: Record<GuestWipeCategory, string> = {
      locks: "Door Codes & Locks",
      wifi: "WiFi Passwords",
      voice_history: "Voice Command History",
      tv_logins: "TV & Streaming Logins",
      preferences: "Guest Preferences",
      personal_data: "Personal Data",
    };
    return labels[category];
  };

  if (tenant?.vertical !== "clever_host") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-semibold text-slate-900">
          Guest Management
        </p>
        <p className="mt-1 text-sm text-slate-500">
          This feature is available for CleverHost properties only.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-900">Guest Management</h2>
        <div className="card animate-pulse">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Guest Management</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage reservations, guest profiles, and turnover checklists
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {(["all", "upcoming", "active", "completed", "cancelled"] as const).map(
          (status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                statusFilter === status
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          )
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Reservation list */}
        <div className="lg:col-span-2">
          <div className="space-y-3">
            {reservations.map((reservation) => {
              const isSelected = selectedReservation?.id === reservation.id;
              const checkIn = new Date(reservation.check_in);
              const checkOut = new Date(reservation.check_out);
              const nights = Math.ceil(
                (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
              );

              return (
                <button
                  key={reservation.id}
                  onClick={() => loadReservationDetails(reservation)}
                  className={`card w-full cursor-pointer text-left transition-all hover:shadow-md ${
                    isSelected ? "ring-2 ring-brand-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={statusBadge(reservation.status)}>
                          {reservation.status}
                        </span>
                        <span className="badge-neutral">
                          {reservation.platform}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {checkIn.toLocaleDateString()} &mdash;{" "}
                        {checkOut.toLocaleDateString()}
                      </p>
                      <p className="text-xs text-slate-500">
                        {nights} night{nights !== 1 ? "s" : ""} &middot;{" "}
                        {reservation.guest_count} guest
                        {reservation.guest_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    {reservation.status === "completed" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void initiateWipe(reservation.id as string);
                        }}
                        className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
                      >
                        Initiate Wipe
                      </button>
                    )}
                  </div>
                </button>
              );
            })}

            {reservations.length === 0 && (
              <div className="flex flex-col items-center rounded-xl border-2 border-dashed border-slate-200 py-16">
                <p className="text-sm text-slate-500">No reservations found</p>
              </div>
            )}
          </div>
        </div>

        {/* Selected reservation detail */}
        <div>
          {selectedReservation ? (
            <div className="space-y-4">
              {/* Guest profile */}
              <div className="card">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">
                  Guest Profile
                </h3>
                {guestProfile ? (
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-slate-500">Name:</span>{" "}
                      <span className="font-medium text-slate-900">
                        {guestProfile.display_name}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Door Code:</span>{" "}
                      <span className="font-mono text-slate-900">
                        {guestProfile.door_code}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">WiFi:</span>{" "}
                      <span className="font-mono text-slate-900">
                        {guestProfile.wifi_password}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Expires:</span>{" "}
                      <span className="text-slate-900">
                        {new Date(guestProfile.expires_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No guest profile created yet
                  </p>
                )}
              </div>

              {/* Wipe checklist */}
              <div className="card">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">
                  Turnover Wipe Checklist
                </h3>
                {wipeChecklist ? (
                  <div className="space-y-2">
                    {wipeChecklist.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              item.status === "completed"
                                ? "bg-green-500"
                                : item.status === "in_progress"
                                  ? "bg-amber-500"
                                  : item.status === "failed"
                                    ? "bg-red-500"
                                    : "bg-slate-300"
                            }`}
                          />
                          <span className="text-xs text-slate-700">
                            {wipeCategoryLabel(item.category)}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-medium ${
                            item.status === "completed"
                              ? "text-green-600"
                              : item.status === "failed"
                                ? "text-red-600"
                                : "text-slate-500"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    ))}
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p
                        className={`text-xs font-semibold ${
                          wipeChecklist.is_complete
                            ? "text-green-600"
                            : "text-amber-600"
                        }`}
                      >
                        {wipeChecklist.is_complete
                          ? "Wipe complete - Property ready for next guest"
                          : "Wipe in progress - DO NOT check in next guest"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No wipe initiated for this reservation
                  </p>
                )}
              </div>

              {/* Turnover tasks */}
              {turnoverTasks.length > 0 && (
                <div className="card">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">
                    Turnover Tasks
                  </h3>
                  <div className="space-y-2">
                    {turnoverTasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <span className="text-xs text-slate-700">
                          {task.type.charAt(0).toUpperCase() + task.type.slice(1)}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            task.status === "completed"
                              ? "text-green-600"
                              : task.status === "failed"
                                ? "text-red-600"
                                : "text-slate-500"
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card text-center">
              <p className="text-sm text-slate-500">
                Select a reservation to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
