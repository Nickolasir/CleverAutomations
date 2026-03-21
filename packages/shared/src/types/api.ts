/** API response and error types shared across all packages */

export interface ApiResponse<T> {
  data: T;
  error: null;
}

export interface ApiError {
  data: null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  error: null;
}

/** Rate limit info returned in headers */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset_at: string;
}

/** Health check response — the ONLY public endpoint */
export interface HealthCheck {
  status: "ok" | "degraded" | "down";
  version: string;
  timestamp: string;
  services: {
    database: "ok" | "down";
    voice_pipeline: "ok" | "degraded" | "down";
    home_assistant: "ok" | "down";
  };
}
