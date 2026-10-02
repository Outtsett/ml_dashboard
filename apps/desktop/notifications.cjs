/**
 * ML Dashboard - Native Notification Manager
 *
 * Provides categorized native OS notifications with per-category
 * enable/sound preferences.
 */
const { Notification } = require("electron");

const CATEGORIES = {
  training: { enabled: true, sound: false },
  backtest: { enabled: true, sound: false },
  error: { enabled: true, sound: true },
  system: { enabled: true, sound: false },
};

let preferences = { ...CATEGORIES };

/**
 * Show a native OS notification.
 * @param {{ title: string, body: string, category?: string, urgency?: string, silent?: boolean }} opts
 */
function showNotification({ title, body, category = "system", urgency = "normal", silent }) {
  if (!preferences[category]?.enabled) return;

  if (!Notification.isSupported()) {
    console.warn("[notify] Notifications not supported on this platform");
    return;
  }

  const notification = new Notification({
    title,
    body,
    urgency,
    silent: silent ?? !preferences[category]?.sound,
  });

  notification.show();
  return notification;
}

function updatePreferences(prefs) {
  preferences = { ...preferences, ...prefs };
}

module.exports = { showNotification, updatePreferences, CATEGORIES };
