"use client";

import type { Scene } from "@clever/shared";

/**
 * Scene activation card for TV.
 * Shows scene name + description. Enter/OK activates the scene.
 * Visual feedback while activating.
 */

const SCENE_ICONS: Record<string, string> = {
  "good morning": "🌅",
  "good night": "🌙",
  "movie night": "🎬",
  "dinner time": "🍽️",
  "i'm leaving": "👋",
  "i'm home": "🏠",
  party: "🎉",
  relax: "🧘",
};

function getSceneIcon(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(SCENE_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "⚡";
}

interface TVSceneCardProps {
  scene: Scene;
  isActivating: boolean;
  onActivate: (sceneId: string) => void;
}

export function TVSceneCard({ scene, isActivating, onActivate }: TVSceneCardProps) {
  const icon = getSceneIcon(scene.name);

  const handleActivate = () => {
    if (!isActivating) {
      onActivate(scene.id);
    }
  };

  return (
    <button
      data-tv-focusable
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleActivate();
        }
      }}
      className={`
        flex items-center gap-4 rounded-2xl px-6 py-5
        min-w-[220px] min-h-[80px] text-left transition-all
        ${
          isActivating
            ? "bg-tv-focus text-tv-bg scale-95"
            : "bg-tv-surface hover:bg-tv-surface-hover text-tv-text"
        }
      `}
    >
      <span className="text-3xl">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xl font-semibold truncate">{scene.name}</p>
        {scene.description && (
          <p className="text-sm text-tv-muted truncate mt-0.5">
            {scene.description}
          </p>
        )}
      </div>
      {isActivating && (
        <span className="text-lg animate-pulse">Running...</span>
      )}
    </button>
  );
}
