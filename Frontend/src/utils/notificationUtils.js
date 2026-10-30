export function normalizeNotifications(payload) {
  if (!payload || typeof payload !== "object") return [];

  const notifications = Array.isArray(payload.notifications)
    ? payload.notifications
    : [];

  return notifications.filter((notification) => notification && typeof notification === "object");
}

export function getUnreadCount(notifications) {
  return normalizeNotifications({ notifications }).filter(
    (notification) => !notification.is_read,
  ).length;
}
