/**
 * Home Assistant API Simulator
 *
 * A lightweight Express server that implements the exact REST API contract
 * used by HARestClient. Designed for integration testing without a real
 * Home Assistant instance.
 *
 * Usage:
 *   npx tsx tests/ha-simulator.ts          # start standalone on port 18123
 *   import { startSimulator } from "./ha-simulator";  # programmatic use
 */

import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";

// ---------------------------------------------------------------------------
// HA type interfaces (match rest-client.ts exactly)
// ---------------------------------------------------------------------------

interface HAEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: { id: string; parent_id: string | null; user_id: string | null };
}

interface HAConfig {
  latitude: number;
  longitude: number;
  elevation: number;
  unit_system: Record<string, string>;
  location_name: string;
  time_zone: string;
  version: string;
  components: string[];
  state: "RUNNING" | "NOT_RUNNING";
}

interface HAAreaRegistryEntry {
  area_id: string;
  name: string;
  floor_id: string | null;
  aliases: string[];
}

interface HAEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  name: string | null;
  original_name: string;
  platform: string;
}

// ---------------------------------------------------------------------------
// Auth token
// ---------------------------------------------------------------------------

const AUTH_TOKEN = "test-token-ha-simulator";

// ---------------------------------------------------------------------------
// Initial entity definitions
// ---------------------------------------------------------------------------

function makeEntity(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown>,
): HAEntityState {
  const now = new Date().toISOString();
  return {
    entity_id,
    state,
    attributes,
    last_changed: now,
    last_updated: now,
    context: { id: crypto.randomUUID(), parent_id: null, user_id: null },
  };
}

function buildInitialEntities(): HAEntityState[] {
  return [
    // Living Room
    makeEntity("light.living_room_main", "off", {
      friendly_name: "Living Room Main Light",
      brightness: 0,
      color_mode: "brightness",
      supported_color_modes: ["brightness"],
    }),
    makeEntity("media_player.living_room", "idle", {
      friendly_name: "Living Room TV",
      volume_level: 0.5,
      media_content_type: null,
    }),
    makeEntity("fan.living_room_fan", "off", {
      friendly_name: "Living Room Fan",
      percentage: 0,
      speed_count: 3,
    }),
    // Master Bedroom
    makeEntity("light.bedroom_lamp", "off", {
      friendly_name: "Bedroom Lamp",
      brightness: 0,
      color_mode: "brightness",
      supported_color_modes: ["brightness"],
    }),
    makeEntity("switch.bedroom_outlet", "off", {
      friendly_name: "Bedroom Outlet",
    }),
    // Kitchen
    makeEntity("light.kitchen_lights", "on", {
      friendly_name: "Kitchen Lights",
      brightness: 200,
      color_mode: "brightness",
      supported_color_modes: ["brightness"],
    }),
    // Front Entry
    makeEntity("lock.front_door", "locked", {
      friendly_name: "Front Door Lock",
    }),
    makeEntity("lock.kitchen_door", "locked", {
      friendly_name: "Kitchen Door Lock",
    }),
    // Hallway
    makeEntity("climate.main_thermostat", "cool", {
      friendly_name: "Main Thermostat",
      temperature: 72,
      current_temperature: 74,
      hvac_modes: ["off", "heat", "cool", "auto"],
      hvac_action: "cooling",
      min_temp: 60,
      max_temp: 90,
      target_temp_step: 1,
    }),
    makeEntity("camera.front_porch", "idle", {
      friendly_name: "Front Porch Camera",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Area and entity registries
// ---------------------------------------------------------------------------

const AREAS: HAAreaRegistryEntry[] = [
  { area_id: "living_room", name: "Living Room", floor_id: "ground", aliases: [] },
  { area_id: "master_bedroom", name: "Master Bedroom", floor_id: "upper", aliases: [] },
  { area_id: "kitchen", name: "Kitchen", floor_id: "ground", aliases: [] },
  { area_id: "front_entry", name: "Front Entry", floor_id: "ground", aliases: [] },
  { area_id: "hallway", name: "Hallway", floor_id: "ground", aliases: [] },
];

function buildEntityRegistry(): HAEntityRegistryEntry[] {
  const areaMap: Record<string, string> = {
    "light.living_room_main": "living_room",
    "media_player.living_room": "living_room",
    "fan.living_room_fan": "living_room",
    "light.bedroom_lamp": "master_bedroom",
    "switch.bedroom_outlet": "master_bedroom",
    "light.kitchen_lights": "kitchen",
    "lock.front_door": "front_entry",
    "lock.kitchen_door": "front_entry",
    "climate.main_thermostat": "hallway",
    "camera.front_porch": "hallway",
  };

  return Object.entries(areaMap).map(([entity_id, area_id]) => {
    const domain = entity_id.split(".")[0]!;
    const name_part = entity_id.split(".")[1]!;
    const friendlyName = name_part
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    return {
      entity_id,
      area_id,
      device_id: `device_${name_part}`,
      name: null,
      original_name: friendlyName,
      platform: domain === "camera" ? "generic" : domain,
    };
  });
}

// ---------------------------------------------------------------------------
// HA Config
// ---------------------------------------------------------------------------

const HA_CONFIG: HAConfig = {
  latitude: 30.2672,
  longitude: -97.7431,
  elevation: 149,
  unit_system: {
    length: "mi",
    accumulated_precipitation: "in",
    mass: "lb",
    pressure: "psi",
    temperature: "°F",
    volume: "gal",
    wind_speed: "mph",
  },
  location_name: "CleverHub Demo",
  time_zone: "America/Chicago",
  version: "2024.12.0",
  components: [
    "light",
    "lock",
    "climate",
    "switch",
    "media_player",
    "fan",
    "camera",
    "cover",
    "scene",
    "automation",
  ],
  state: "RUNNING",
};

// ---------------------------------------------------------------------------
// Service call handlers
// ---------------------------------------------------------------------------

type ServiceHandler = (
  entity: HAEntityState,
  params: Record<string, unknown>,
) => void;

const SERVICE_HANDLERS: Record<string, ServiceHandler> = {
  "light/turn_on": (entity, params) => {
    entity.state = "on";
    if (params.brightness !== undefined) {
      entity.attributes.brightness = params.brightness;
    } else if (entity.attributes.brightness === 0) {
      entity.attributes.brightness = 255;
    }
    if (params.brightness_pct !== undefined) {
      entity.attributes.brightness = Math.round(
        (Number(params.brightness_pct) / 100) * 255,
      );
    }
    if (params.rgb_color !== undefined) {
      entity.attributes.rgb_color = params.rgb_color;
    }
  },
  "light/turn_off": (entity) => {
    entity.state = "off";
    entity.attributes.brightness = 0;
  },
  "lock/lock": (entity) => {
    entity.state = "locked";
  },
  "lock/unlock": (entity) => {
    entity.state = "unlocked";
  },
  "climate/set_temperature": (entity, params) => {
    if (params.temperature !== undefined) {
      const min = (entity.attributes.min_temp as number) ?? 60;
      const max = (entity.attributes.max_temp as number) ?? 90;
      entity.attributes.temperature = Math.max(
        min,
        Math.min(max, Number(params.temperature)),
      );
    }
    if (params.hvac_mode !== undefined) {
      entity.state = String(params.hvac_mode);
    }
  },
  "climate/set_hvac_mode": (entity, params) => {
    if (params.hvac_mode !== undefined) {
      entity.state = String(params.hvac_mode);
    }
  },
  "switch/turn_on": (entity) => {
    entity.state = "on";
  },
  "switch/turn_off": (entity) => {
    entity.state = "off";
  },
  "media_player/turn_on": (entity) => {
    entity.state = "playing";
  },
  "media_player/turn_off": (entity) => {
    entity.state = "idle";
  },
  "media_player/volume_set": (entity, params) => {
    if (params.volume_level !== undefined) {
      entity.attributes.volume_level = Number(params.volume_level);
    }
  },
  "media_player/media_play": (entity) => {
    entity.state = "playing";
  },
  "media_player/media_pause": (entity) => {
    entity.state = "paused";
  },
  "fan/turn_on": (entity, params) => {
    entity.state = "on";
    entity.attributes.percentage =
      params.percentage !== undefined ? Number(params.percentage) : 50;
  },
  "fan/turn_off": (entity) => {
    entity.state = "off";
    entity.attributes.percentage = 0;
  },
  "cover/open_cover": (entity) => {
    entity.state = "open";
  },
  "cover/close_cover": (entity) => {
    entity.state = "closed";
  },
  "scene/turn_on": () => {
    // no-op
  },
};

// ---------------------------------------------------------------------------
// Express app factory
// ---------------------------------------------------------------------------

function createApp(entities: Map<string, HAEntityState>) {
  const app = express();
  app.use(express.json());

  // Auth middleware
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  });

  // GET /api/config
  app.get("/api/config", (_req: Request, res: Response) => {
    res.json(HA_CONFIG);
  });

  // GET /api/states
  app.get("/api/states", (_req: Request, res: Response) => {
    res.json(Array.from(entities.values()));
  });

  // GET /api/states/:entity_id
  app.get("/api/states/:entity_id", (req: Request, res: Response) => {
    const entity = entities.get(String(req.params.entity_id));
    if (!entity) {
      res.status(404).json({ message: "Entity not found" });
      return;
    }
    res.json(entity);
  });

  // POST /api/services/:domain/:service
  app.post(
    "/api/services/:domain/:service",
    (req: Request, res: Response) => {
      const { domain, service } = req.params;
      const key = `${domain}/${service}`;
      const handler = SERVICE_HANDLERS[key];

      if (!handler) {
        // Unknown service -- still return 200 with empty array (HA behavior)
        res.json([]);
        return;
      }

      const body = req.body as Record<string, unknown>;
      const entityId = body.entity_id as string | undefined;

      // Determine which entities to act on
      const targetEntities: HAEntityState[] = [];
      if (entityId) {
        const entity = entities.get(entityId);
        if (entity) {
          targetEntities.push(entity);
        }
      }

      const now = new Date().toISOString();
      for (const entity of targetEntities) {
        handler(entity, body);
        entity.last_changed = now;
        entity.last_updated = now;
        entity.context.id = crypto.randomUUID();
      }

      res.json(targetEntities);
    },
  );

  // GET /api/config/area_registry/list
  app.get("/api/config/area_registry/list", (_req: Request, res: Response) => {
    res.json(AREAS);
  });

  // GET /api/config/entity_registry/list
  app.get(
    "/api/config/entity_registry/list",
    (_req: Request, res: Response) => {
      res.json(buildEntityRegistry());
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SimulatorHandle {
  server: Server;
  port: number;
  resetState: () => void;
}

export function startSimulator(port: number = 18123): Promise<SimulatorHandle> {
  const entityMap = new Map<string, HAEntityState>();

  function resetState() {
    entityMap.clear();
    for (const entity of buildInitialEntities()) {
      entityMap.set(entity.entity_id, entity);
    }
  }

  resetState();

  const app = createApp(entityMap);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      resolve({ server, port, resetState });
    });
    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Direct execution
// ---------------------------------------------------------------------------

const isDirectExecution =
  process.argv[1]?.replace(/\\/g, "/").endsWith("tests/ha-simulator.ts") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("tests/ha-simulator");

if (isDirectExecution) {
  const port = Number(process.env.PORT) || 18123;
  startSimulator(port).then(({ port: p }) => {
    console.log(`HA Simulator running on http://localhost:${p}`);
    console.log(`Auth token: ${AUTH_TOKEN}`);
    console.log(`Press Ctrl+C to stop`);
  });
}
