/**
 * Build-time application settings injected from the repository-root
 * settings.ini by Vite. They are intentionally limited to public feature
 * flags: secrets and authority-service configuration belong in environment
 * variables instead.
 */
declare const __CARD_GAME_MULTIPLAYER_GAME_ENABLED__: boolean;

export const appSettings = Object.freeze({
  multiplayerGameEnabled: __CARD_GAME_MULTIPLAYER_GAME_ENABLED__
});
