/**
 * @clever/ha-bridge — Home Assistant integration package.
 *
 * Provides REST and WebSocket clients for communicating with
 * Home Assistant, device auto-discovery, intent-to-command execution,
 * and built-in scene definitions.
 */

// REST client
export {
  HARestClient,
  entityIdToCategory,
  mapHAState,
} from "./rest-client.js";
export type {
  HARestClientConfig,
  HAEntityState,
  HAConfig,
  HAServiceCallPayload,
  HAAreaRegistryEntry,
  HAEntityRegistryEntry,
} from "./rest-client.js";

// WebSocket client
export { HAWebSocketClient } from "./websocket-client.js";
export type {
  HAWebSocketClientConfig,
  HAWebSocketClientEvents,
  DeviceStateChangedEvent,
} from "./websocket-client.js";

// Device discovery
export { DeviceDiscovery } from "./device-discovery.js";
export type {
  DeviceStore,
  DeviceDiscoveryConfig,
  DiscoveryResult,
} from "./device-discovery.js";

// Command executor
export { CommandExecutor } from "./command-executor.js";
export type {
  DeviceResolver,
  CommandExecutorConfig,
  ExecutionResult,
} from "./command-executor.js";

// Scenes
export {
  SceneExecutor,
  BUILTIN_SCENES,
  listBuiltinScenes,
  builtinSceneDisplayName,
} from "./scenes.js";
export type {
  SceneExecutionResult,
  SceneStep,
  SceneExecutorConfig,
} from "./scenes.js";
