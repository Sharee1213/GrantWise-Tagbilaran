import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../services/api.js";
import {
  getUnreadCount,
  normalizeNotifications,
} from "../utils/notificationUtils.js";

export default function NotificationBell({ listPath, readPath }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const unreadCount = useMemo(
    () => getUnreadCount(notifications),
    [notifications],
  );

  const fetchNotifications = useCallback(async () => {
    if (!listPath) return;

    try {
      setLoading(true);
      const payload = await apiRequest(listPath);
      setNotifications(normalizeNotifications(payload));
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [listPath]);

  useEffect(() => {
    if (!listPath) {
      setNotifications([]);
      return undefined;
    }

    const refresh = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        fetchNotifications();
      }
    };

    refresh();

    const timerId = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchNotifications, listPath]);

  async function handleMarkRead(notificationId) {
    const target = notifications.find(
      (notification) => notification.notification_id === notificationId,
    );

    if (!target || target.is_read || typeof readPath !== "function") {
      return;
    }

    const previousNotifications = notifications;
    setNotifications((current) =>
      current.map((notification) =>
        notification.notification_id === notificationId
          ? { ...notification, is_read: true }
          : notification,
      ),
    );

    try {
      await apiRequest(readPath(notificationId), { method: "PATCH" });
    } catch {
      setNotifications(previousNotifications);
    }
  }

  if (!listPath || !readPath) return null;

  return (
    <div className="notification-bell-container">
      <button
        type="button"
        className="notification-bell-button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Toggle notifications"
        aria-expanded={open}
      >
        <Bell size={16} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-bell-badge" aria-label={`${unreadCount} unread notifications`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell-panel" role="dialog" aria-label="Notifications">
          <div className="notification-bell-header">
            <strong>Notifications</strong>
            <span>{notifications.length} total</span>
          </div>

          {loading && notifications.length === 0 ? (
            <div className="notification-empty">Loading notifications…</div>
          ) : notifications.length === 0 ? (
            <div className="notification-empty">You have no notifications yet.</div>
          ) : (
            <ul className="notification-bell-list">
              {notifications.map((notification) => {
                const isUnread = !notification.is_read;

                return (
                  <li
                    key={notification.notification_id}
                    className={`notification-bell-item ${isUnread ? "is-unread" : "is-read"}`}
                  >
                    <div className="notification-bell-copy">
                      <span className="notification-bell-title">{notification.title || "Notification"}</span>
                      <span className="notification-bell-message">{notification.message}</span>
                      <span className="notification-bell-time">
                        {notification.created_at
                          ? new Date(notification.created_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Just now"}
                      </span>
                    </div>

                    {isUnread && (
                      <button
                        type="button"
                        className="notification-mark-read"
                        onClick={() => handleMarkRead(notification.notification_id)}
                        aria-label={`Mark ${notification.title || "this notification"} as read`}
                        title="Mark as read"
                      >
                        <CheckCheck size={14} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
