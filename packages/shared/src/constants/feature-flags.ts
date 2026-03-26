/**
 * HARD-CODED FEATURE FLAGS
 *
 * These require a source code change + rebuild + redeploy to toggle.
 * They CANNOT be changed via configuration, database, environment
 * variables, voice commands, or chat commands.
 */

/**
 * Email sending via HA services (o365.send_email, notify.smtp_gmail).
 * Set to `true` ONLY when explicitly authorized by the system owner.
 *
 * When false:
 *   - Orchestrator returns a refusal message for send/compose/reply requests
 *   - HA bridge send methods throw Error before making any HA API call
 *   - Frontend hides all compose/send UI elements
 */
export const EMAIL_SEND_ENABLED = false as const;
