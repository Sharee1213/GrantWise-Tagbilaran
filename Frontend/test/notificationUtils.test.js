import test from "node:test";
import assert from "node:assert/strict";

import {
  getUnreadCount,
  normalizeNotifications,
} from "../src/utils/notificationUtils.js";

test("treats an empty notification list as a normal empty state", () => {
  const notifications = normalizeNotifications({ notifications: [] });

  assert.deepEqual(notifications, []);
  assert.equal(getUnreadCount(notifications), 0);
});

test("counts only unread notifications", () => {
  const notifications = normalizeNotifications({
    notifications: [
      { notification_id: 1, is_read: false },
      { notification_id: 2, is_read: true },
      { notification_id: 3, is_read: false },
    ],
  });

  assert.equal(getUnreadCount(notifications), 2);
});
