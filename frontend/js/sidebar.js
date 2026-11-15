function getUserInitials(name = "") {
    return name.trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map(part => part[0])
        .join("")
        .toUpperCase();
}

function isAssignmentComplete(assignment) {
    if (assignment.is_done === true) return true;
    return ["complete", "completed", "done"].includes(
        String(assignment.assignment_state || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
    );
}

function getTaskDeadlineState(task, now = new Date()) {
    const timestamp = String(task.package_deadline_at || "");
    const timestampDate = /^\d{4}-\d{2}-\d{2}/.test(timestamp)
        ? timestamp.slice(0, 10)
        : "";
    const date = timestampDate || String(task.package_deadline_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

    const [year, month, day] = date.split("-").map(Number);
    const dueDate = new Date(Date.UTC(year, month - 1, day));
    if (dueDate.getUTCFullYear() !== year ||
        dueDate.getUTCMonth() !== month - 1 ||
        dueDate.getUTCDate() !== day) return null;

    const timestampHasTime = Boolean(timestamp && !/^\d{4}-\d{2}-\d{2}$/.test(timestamp));
    const hasExactTime = Boolean(timestampHasTime || task.package_deadline_time);
    const dueAt = timestampHasTime
        ? new Date(timestamp)
        : hasExactTime
            ? new Date(`${date}T${task.package_deadline_time}`)
            : null;
    if (hasExactTime && (!dueAt || Number.isNaN(dueAt.getTime()))) return null;

    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const daysUntil = Math.floor((dueDate.getTime() - today) / 86400000);
    if ((hasExactTime && dueAt <= now) || (!hasExactTime && daysUntil < 0)) {
        return { type: "overdue", daysUntil };
    }
    if (daysUntil >= 0 && daysUntil <= 3) {
        return { type: "deadline", daysUntil };
    }
    return null;
}

function formatNotificationDeadline(task) {
    const timestamp = String(task.package_deadline_at || "");
    const timestampHasTime = Boolean(timestamp && !/^\d{4}-\d{2}-\d{2}$/.test(timestamp));
    const hasExactTime = Boolean(timestampHasTime || task.package_deadline_time);
    const dateOnly = !hasExactTime;
    const dateValue = /^\d{4}-\d{2}-\d{2}/.test(timestamp)
        ? timestamp.slice(0, 10)
        : String(task.package_deadline_date || "");
    const value = timestamp && !/^\d{4}-\d{2}-\d{2}$/.test(timestamp)
        ? timestamp
        : dateValue
            ? `${dateValue}T${task.package_deadline_time || "00:00:00"}`
            : "";
    let date;
    if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        const [year, month, day] = dateValue.split("-").map(Number);
        date = new Date(year, month - 1, day);
    } else {
        date = new Date(value);
    }
    if (!value || Number.isNaN(date.getTime())) return "Chưa có deadline";
    return new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(!dateOnly && (task.package_deadline_time || timestamp.includes("T"))
            ? { hour: "2-digit", minute: "2-digit" }
            : {})
    }).format(date);
}

function renderAppNotificationCenter(notifications, container, loadError = "") {
    const bell = container.querySelector("#notificationBellButton");
    const badge = container.querySelector("#notificationUnreadCount");
    const panel = container.querySelector("#notificationPanel");
    const list = container.querySelector("#notificationList");
    const markAllButton = container.querySelector("#markAllNotificationsRead");
    if (!bell || !badge || !panel || !list) return [];

    const unreadCount = notifications.filter(notification => !notification.is_read).length;
    if (markAllButton) markAllButton.disabled = unreadCount === 0;
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
    bell.setAttribute("aria-label", unreadCount
        ? `Thông báo, ${unreadCount} chưa đọc`
        : "Thông báo");

    list.replaceChildren();
    if (!notifications.length) {
        const empty = document.createElement("p");
        empty.className = "notification-list-empty";
        empty.textContent = loadError || "Chưa có thông báo.";
        list.appendChild(empty);
        return notifications;
    }

    notifications.forEach(notification => {
        const item = document.createElement("div");
        item.className = `notification-item${notification.is_read ? "" : " is-unread"}`;
        item.dataset.notificationId = notification.notification_id;
        if (notification.task_id) item.dataset.taskId = notification.task_id;

        const main = document.createElement("div");
        main.className = "notification-item-main";
        main.tabIndex = 0;
        main.setAttribute("role", "button");
        main.setAttribute("aria-label", `Xem chi tiết: ${notification.title}`);

        const icon = document.createElement("span");
        icon.className = "notification-item-icon";
        const iconElement = document.createElement("i");
        iconElement.setAttribute("data-lucide", notification.type === "deadline_overdue"
            ? "triangle-alert"
            : notification.type === "task_assigned"
                ? "clipboard-check"
                : "calendar-clock");
        icon.appendChild(iconElement);

        const content = document.createElement("span");
        content.className = "notification-item-content";
        const title = document.createElement("strong");
        title.textContent = notification.title;
        const message = document.createElement("span");
        message.textContent = notification.message;
        const date = document.createElement("small");
        date.textContent = new Intl.DateTimeFormat(window.AppI18n?.locale || "vi-VN", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(notification.created_at));
        content.append(title, message, date);
        main.appendChild(icon);
        main.appendChild(content);

        // Nút / Ô tròn đánh dấu đã đọc
        const checkBtn = document.createElement("button");
        checkBtn.type = "button";
        checkBtn.className = "notification-check-btn";
        checkBtn.title = notification.is_read ? "Đã đọc" : "Đánh dấu đã đọc";
        checkBtn.setAttribute("aria-label", notification.is_read ? "Đã đọc" : "Đánh dấu đã đọc");
        const checkIcon = document.createElement("i");
        checkIcon.setAttribute("data-lucide", "check");
        checkBtn.appendChild(checkIcon);

        item.appendChild(main);
        item.appendChild(checkBtn);
        list.appendChild(item);
    });

    if (loadError) {
        const error = document.createElement("p");
        error.className = "notification-list-empty";
        error.textContent = loadError;
        list.appendChild(error);
    }
    if (window.lucide) window.lucide.createIcons();
    return notifications;
}

function showAppNotificationToast(notification, unreadCount, openPanel) {
    const toast = document.createElement("div");
    toast.className = "notification-toast";
    toast.setAttribute("role", "status");

    const icon = document.createElement("span");
    icon.className = "notification-toast-icon";
    const iconElement = document.createElement("i");
    iconElement.setAttribute("data-lucide", "bell-ring");
    icon.appendChild(iconElement);

    const content = document.createElement("span");
    content.className = "notification-toast-content";
    const title = document.createElement("strong");
    title.textContent = unreadCount > 1
        ? `Bạn có ${unreadCount} thông báo chưa đọc`
        : notification.title;
    const message = document.createElement("span");
    message.textContent = notification.message;
    content.append(title, message);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "notification-toast-close";
    close.setAttribute("aria-label", "Đóng thông báo");
    const closeIcon = document.createElement("i");
    closeIcon.setAttribute("data-lucide", "x");
    close.appendChild(closeIcon);
    close.addEventListener("click", event => {
        event.stopPropagation();
        toast.remove();
    });

    toast.append(icon, content, close);
    toast.addEventListener("click", openPanel);
    document.body.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    window.setTimeout(() => toast.remove(), 7000);
}

async function initializeAppNotificationCenter(user, container) {
    const bell = container.querySelector("#notificationBellButton");
    const panel = container.querySelector("#notificationPanel");
    const list = container.querySelector("#notificationList");
    const markAllButton = container.querySelector("#markAllNotificationsRead");
    const detailModal = container.querySelector("#notificationDetailModal");
    const detailTitle = container.querySelector("#notificationDetailTitle");
    const detailMessage = container.querySelector("#notificationDetailMessage");
    const detailPriority = container.querySelector("#notificationDetailPriority");
    const detailDate = container.querySelector("#notificationDetailDate");
    const openTaskButton = container.querySelector("#openNotificationTask");
    if (!bell || !panel || !list || !markAllButton) return;

    const client = window.supabaseClient;
    const userId = user.id;
    let notifications = [];
    let loadError = "";
    const loadNotifications = async () => {
        const { data, error } = await client
            .from("notifications")
            .select("notification_id, task_id, title, message, type, priority, is_read, created_at, dedupe_key")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(100);
        if (error) throw error;
        notifications = data || [];
        return notifications;
    };
    const openPanel = () => {
        panel.hidden = false;
        bell.setAttribute("aria-expanded", "true");
        renderAppNotificationCenter(notifications, container, loadError);
    };
    const closePanel = () => {
        panel.hidden = true;
        bell.setAttribute("aria-expanded", "false");
    };
    const closeDetail = () => {
        if (detailModal) detailModal.hidden = true;
    };
    const openDetail = notification => {
        if (!detailModal || !detailTitle || !detailMessage || !detailPriority || !detailDate) return;
        detailTitle.textContent = notification.title || "Thông báo";
        detailMessage.textContent = notification.message || "";
        detailPriority.textContent = `Mức độ: ${
            { low: "Thấp", normal: "Bình thường", high: "Cao", urgent: "Khẩn cấp" }[
                notification.priority
            ] || "Bình thường"
        }`;
        detailDate.textContent = new Intl.DateTimeFormat(
            window.AppI18n?.locale || "vi-VN",
            { dateStyle: "medium", timeStyle: "short" }
        ).format(new Date(notification.created_at));
        if (openTaskButton) {
            openTaskButton.hidden = !notification.task_id;
            openTaskButton.dataset.taskId = notification.task_id || "";
        }
        detailModal.hidden = false;
        container.querySelector("#closeNotificationDetail")?.focus();
    };

    bell.addEventListener("click", () => {
        if (panel.hidden) openPanel();
        else closePanel();
    });
    markAllButton.addEventListener("click", async () => {
        markAllButton.disabled = true;
        notifications.forEach(n => { n.is_read = true; n.read_at = new Date().toISOString(); });
        renderAppNotificationCenter(notifications, container, "");

        try {
            // Gọi RPC SECURITY DEFINER để chắc chắn cập nhật thành công trên Supabase
            try {
                await client.rpc("mark_all_notifications_as_read");
            } catch (rpcErr) {
                console.warn("RPC mark_all_notifications_as_read fallback:", rpcErr);
            }

            await client
                .from("notifications")
                .update({ is_read: true, read_at: new Date().toISOString() })
                .eq("user_id", userId)
                .eq("is_read", false);

            await loadNotifications();
            loadError = "";
            renderAppNotificationCenter(notifications, container, "");
        } catch (error) {
            console.error("Không thể cập nhật trạng thái thông báo:", error);
            loadError = "Không thể lưu trạng thái đã đọc.";
            renderAppNotificationCenter(notifications, container, loadError);
        } finally {
            markAllButton.disabled = !notifications.some(notification => !notification.is_read);
        }
    });

    list.addEventListener("click", async event => {
        if (!(event.target instanceof Element)) return;
        const item = event.target.closest("[data-notification-id]");
        if (!item) return;
        let notification = notifications.find(value =>
            value.notification_id === item.dataset.notificationId
        );
        if (!notification) return;

        // Nếu người dùng tích vào ô tròn "Đánh dấu đã đọc"
        const checkBtn = event.target.closest(".notification-check-btn");
        if (checkBtn) {
            event.stopPropagation();
            if (notification.is_read) return;

            notification.is_read = true;
            notification.read_at = new Date().toISOString();
            renderAppNotificationCenter(notifications, container, "");

            try {
                try {
                    await client.rpc("mark_notification_as_read", {
                        p_notification_id: notification.notification_id
                    });
                } catch (rpcErr) {
                    console.warn("RPC mark_notification_as_read fallback:", rpcErr);
                }

                await client
                    .from("notifications")
                    .update({ is_read: true, read_at: new Date().toISOString() })
                    .eq("notification_id", notification.notification_id)
                    .eq("user_id", userId);

                await loadNotifications();
                renderAppNotificationCenter(notifications, container, "");
            } catch (error) {
                console.error("Không thể lưu trạng thái đã đọc:", error);
            }
            return;
        }

        // Bấm vào thân thông báo -> Mở modal chi tiết và tự động đánh dấu đã đọc
        openDetail(notification);

        if (!notification.is_read) {
            notification.is_read = true;
            notification.read_at = new Date().toISOString();
            renderAppNotificationCenter(notifications, container, "");

            try {
                try {
                    await client.rpc("mark_notification_as_read", {
                        p_notification_id: notification.notification_id
                    });
                } catch (rpcErr) {
                    console.warn("RPC mark_notification_as_read fallback:", rpcErr);
                }

                await client
                    .from("notifications")
                    .update({ is_read: true, read_at: new Date().toISOString() })
                    .eq("notification_id", notification.notification_id)
                    .eq("user_id", userId);

                await loadNotifications();
                loadError = "";
                renderAppNotificationCenter(notifications, container, "");
            } catch (error) {
                console.error("Không thể lưu trạng thái đã đọc:", error);
            }
        }
    });

    list.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            const main = event.target.closest(".notification-item-main");
            if (main) {
                event.preventDefault();
                main.click();
            }
        }
    });
    container.querySelector("#closeNotificationDetail")?.addEventListener("click", closeDetail);
    container.querySelector("#dismissNotificationDetail")?.addEventListener("click", closeDetail);
    detailModal?.addEventListener("click", event => {
        if (event.target === detailModal) closeDetail();
    });
    openTaskButton?.addEventListener("click", () => {
        const taskId = openTaskButton.dataset.taskId;
        if (!taskId) return;
        const target = new URL("task-list.html", window.location.href);
        target.searchParams.set("taskId", taskId);
        window.location.href = target.href;
    });
    document.addEventListener("click", event => {
        if (!container.contains(event.target) && !panel.contains(event.target)) closePanel();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            if (detailModal && !detailModal.hidden) closeDetail();
            else closePanel();
        }
    });

    if (!client?.from) {
        loadError = "Không tìm thấy kết nối Supabase.";
        renderAppNotificationCenter(notifications, container, loadError);
        return;
    }

    try {
        await loadNotifications();
        const generated = [];
        let activeTaskIds = [];
        if (user.memberId) {
            const { data: assignments, error: assignmentError } = await client
                .from("task_assignments")
                .select("task_id, member_id, assignment_state, is_done")
                .eq("member_id", user.memberId);
            if (assignmentError) throw assignmentError;

            const taskIds = [...new Set((assignments || []).map(item => String(item.task_id)))];
            let tasks = [];
            if (taskIds.length) {
                const tasksResult = await client.from("tasks").select(`
                        task_id, event_id, task_title, package_deadline_date,
                        package_deadline_time, package_deadline_at, is_cancelled, submission_label
                    `).in("task_id", taskIds);
                if (tasksResult.error) throw tasksResult.error;
                const eventIds = [...new Set((tasksResult.data || [])
                    .map(task => task.event_id)
                    .filter(eventId => eventId != null)
                    .map(String))];
                const eventsResult = eventIds.length
                    ? await client.from("events")
                        .select("event_id, is_completed")
                        .in("event_id", eventIds)
                    : { data: [], error: null };
                if (eventsResult.error) throw eventsResult.error;
                const activeEventIds = new Set((eventsResult.data || [])
                    .filter(event => event.is_completed !== true)
                    .map(event => String(event.event_id)));
                tasks = (tasksResult.data || []).filter(task =>
                    task.event_id != null &&
                    activeEventIds.has(String(task.event_id)) &&
                    task.is_cancelled !== true
                );
            }

            const assignmentsByTask = new Map();
            (assignments || []).forEach(assignment => {
                const taskKey = String(assignment.task_id);
                const taskAssignments = assignmentsByTask.get(taskKey) || [];
                taskAssignments.push(assignment);
                assignmentsByTask.set(taskKey, taskAssignments);
            });

            const snapshotKey = `mediatask_assignment_snapshot_v1:${userId}`;
            const previousSnapshot = localStorage.getItem(snapshotKey);
            const previousTaskIds = previousSnapshot === null
                ? null
                : new Set(JSON.parse(previousSnapshot).map(String));
            activeTaskIds = tasks.map(task => String(task.task_id));

            tasks.forEach(task => {
                const taskId = String(task.task_id);
                const ownAssignments = assignmentsByTask.get(taskId) || [];
                const isIncomplete = ownAssignments.some(assignment => !isAssignmentComplete(assignment));
                const title = task.task_title || task.submission_label || task.task_id;
                const deadlineKey = task.package_deadline_at ||
                    `${task.package_deadline_date || ""}T${task.package_deadline_time || ""}`;

                if (previousTaskIds && !previousTaskIds.has(taskId) && isIncomplete) {
                    generated.push({
                        task_id: taskId,
                        type: "task_assigned",
                        title: "Bạn vừa được giao công việc",
                        message: title,
                        dedupe_key: `task_assigned:${taskId}`
                    });
                }

                if (!isIncomplete) return;
                const deadlineState = getTaskDeadlineState(task);
                if (!deadlineState) return;

                const type = deadlineState.type === "overdue"
                    ? "deadline_overdue"
                    : "deadline_reminder";
                const message = deadlineState.type === "overdue"
                    ? `${title} đã quá hạn (${formatNotificationDeadline(task)}).`
                    : `${title} sắp đến hạn (${formatNotificationDeadline(task)}).`;
                generated.push({
                    task_id: taskId,
                    type,
                    title: deadlineState.type === "overdue" ? "Công việc quá hạn" : "Deadline sắp đến",
                    message,
                    dedupe_key: `${type}:${taskId}:${deadlineKey}`
                });
            });
        } else {
            loadError = "Tài khoản chưa được liên kết với thành viên.";
        }

        const generatedKeys = [...new Set(generated.map(item => item.dedupe_key))];
        let existingKeys = new Set();
        if (generatedKeys.length) {
            const { data, error } = await client
                .from("notifications")
                .select("dedupe_key")
                .eq("user_id", userId)
                .in("dedupe_key", generatedKeys);
            if (error) throw error;
            existingKeys = new Set((data || []).map(item => item.dedupe_key));
            const newNotifications = generated
                .filter(item => !existingKeys.has(item.dedupe_key))
                .map(item => ({
                    ...item,
                    user_id: userId,
                    member_id: user.memberId,
                    priority: "normal"
                }));
            if (newNotifications.length) {
                const { error: insertError } = await client
                    .from("notifications")
                    .insert(newNotifications);
                if (insertError) throw insertError;
            }
        }

        if (user.memberId) {
            localStorage.setItem(
                `mediatask_assignment_snapshot_v1:${userId}`,
                JSON.stringify(activeTaskIds)
            );
        }
        await loadNotifications();
        renderAppNotificationCenter(notifications, container, loadError);
        const newlyCreated = generated.filter(notification =>
            !existingKeys.has(notification.dedupe_key)
        );
        const popupSessionKey = `mediatask_notification_popup_v1:${userId}`;
        let popupShown = false;
        try {
            popupShown = sessionStorage.getItem(popupSessionKey) === "shown";
        } catch (error) {
            console.error("Không thể đọc trạng thái popup thông báo:", error);
        }
        const unreadNotifications = notifications.filter(notification => !notification.is_read);
        if (unreadNotifications.length && (newlyCreated.length || !popupShown)) {
            try {
                sessionStorage.setItem(popupSessionKey, "shown");
            } catch (error) {
                console.error("Không thể lưu trạng thái popup thông báo:", error);
            }
            const firstUnread = newlyCreated.length
                ? notifications.find(item => item.dedupe_key === newlyCreated[0].dedupe_key)
                : unreadNotifications[0];
            showAppNotificationToast(firstUnread, unreadNotifications.length, openPanel);
        }
    } catch (error) {
        console.error("Không thể tải thông báo:", error);
        loadError = "Không thể tải thông báo. Hãy thử tải lại trang.";
        renderAppNotificationCenter(notifications, container, loadError);
    }
}

window.renderAppUser = function (user) {
    if (!user) return;

    const name = user.name || user.email?.split("@")[0] || "Thành viên";
    const role = user.role || "Thành viên";
    const nameElement = document.querySelector("#userName");
    const roleElement = document.querySelector("#userRole");
    const avatarElement = document.querySelector("#userAvatar");
    const settingsName = document.querySelector("#notificationAccountName");
    const settingsRole = document.querySelector("#notificationAccountRole");
    const settingsAvatar = document.querySelector("#notificationAccountAvatar");

    if (nameElement) nameElement.textContent = name;
    if (roleElement) roleElement.textContent = role;
    if (avatarElement) avatarElement.textContent = getUserInitials(name) || "?";
    if (settingsName) settingsName.textContent = name;
    if (settingsRole) settingsRole.textContent = role;
    if (settingsAvatar) settingsAvatar.textContent = getUserInitials(name) || "?";
};

window.renderChatHistory = function (conversations) {
    const section = document.getElementById("chatHistorySection");
    const list = document.getElementById("chatHistoryList");
    if (!section || !list) return;

    const savedConversations = Array.isArray(conversations) ? conversations : [];
    list.innerHTML = "";
    section.hidden = !savedConversations.length;
    if (!savedConversations.length) return;

    const currentPage = location.pathname.split("/").pop().replace(".html", "");
    savedConversations.forEach(conversation => {
        if (!conversation?.id || !conversation.title) return;

        const item = document.createElement("a");
        item.className = "chat-history-item";
        item.href = `dashboard.html?conversation=${encodeURIComponent(conversation.id)}`;

        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", "message-square");

        const title = document.createElement("span");
        title.textContent = conversation.title;

        item.append(icon, title);
        item.addEventListener("click", event => {
            if (currentPage !== "dashboard") return;
            if (typeof window.openChatConversation !== "function") return;

            event.preventDefault();
            window.openChatConversation(conversation.id);
        });
        list.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
};

window.loadChatHistory = function () {
    try {
        const conversations = JSON.parse(localStorage.getItem("mediatask_conversations") || "[]");
        window.renderChatHistory(conversations);
    } catch (error) {
        console.error("Không thể tải lịch sử trò chuyện:", error);
    }
};

function initializeAceChatbot(container, user) {
    const widget = container.querySelector("#aceChatbotWidget");
    const launcher = container.querySelector("#aceChatbotLauncher");
    const panel = container.querySelector("#aceChatbotPanel");
    const historyToggle = container.querySelector("#aceChatbotHistoryToggle");
    const historyView = container.querySelector("#aceChatbotHistory");
    const historyEmpty = container.querySelector("#aceChatbotHistoryEmpty");
    const minimizeButton = container.querySelector("#aceChatbotMinimize");
    const resetButton = container.querySelector("#aceChatbotReset");
    const messages = container.querySelector("#aceChatbotMessages");
    const form = container.querySelector("#aceChatbotForm");
    const input = container.querySelector("#aceChatbotInput");
    const sendButton = container.querySelector("#aceChatbotSendButton");
    const status = container.querySelector("#aceChatbotStatus");
    if (!widget || !launcher || !panel || !historyToggle || !historyView ||
        !historyEmpty || !minimizeButton || !resetButton ||
        !messages || !form || !input || !sendButton || !status || !user?.id) return;

    const client = window.supabaseClient;
    const initialMessages = messages.innerHTML;
    let isFirstChat = true;
    let widgetStateLoaded = false;

    const setStatus = message => {
        status.textContent = message;
        status.hidden = !message;
    };
    const setComposerEnabled = enabled => {
        input.disabled = !enabled;
        sendButton.disabled = !enabled;
        resetButton.disabled = !enabled;
    };
    const renderWelcome = () => {
        const welcomeText = messages.querySelector(".ace-chatbot-welcome p");
        if (!welcomeText || isFirstChat) return;
        welcomeText.textContent = "Chào mừng bạn quay lại với ACE — AI Companion for Events.";
    };
    const setHistoryView = isOpen => {
        historyView.hidden = !isOpen;
        messages.hidden = isOpen;
        form.hidden = isOpen;
        historyToggle.setAttribute("aria-expanded", String(isOpen));
        historyToggle.setAttribute("aria-label", isOpen ? "Quay lại khung chat" : "Lịch sử trò chuyện");
        historyToggle.title = isOpen ? "Quay lại khung chat" : "Lịch sử trò chuyện";
    };
    const setOpen = isOpen => {
        panel.hidden = !isOpen;
        panel.setAttribute("aria-hidden", String(!isOpen));
        launcher.setAttribute("aria-expanded", String(isOpen));
    };
    const persistWidgetState = async (nextIsFirstChat) => {
        const { error } = await client
            .from("user_widget_state")
            .upsert({
                user_id: user.id,
                is_first_chat: nextIsFirstChat,
                last_visit: new Date().toISOString()
            }, { onConflict: "user_id" });
        if (error) throw error;

        isFirstChat = nextIsFirstChat;
        renderWelcome();
    };
    const loadWidgetState = async () => {
        setComposerEnabled(false);
        setStatus("Đang tải trạng thái chatbot...");
        try {
            if (!client?.from) {
                throw new Error("Không tìm thấy kết nối Supabase.");
            }
            const { data, error } = await client
                .from("user_widget_state")
                .select("is_first_chat")
                .eq("user_id", user.id)
                .maybeSingle();
            if (error) throw error;

            isFirstChat = data ? data.is_first_chat === true : true;
            if (data) {
                const { error: visitError } = await client
                    .from("user_widget_state")
                    .update({ last_visit: new Date().toISOString() })
                    .eq("user_id", user.id);
                if (visitError) throw visitError;
            } else {
                await persistWidgetState(true);
            }
            renderWelcome();
            widgetStateLoaded = true;
            setComposerEnabled(true);
            setStatus("");
        } catch (error) {
            console.error("Không thể tải trạng thái chatbot ACE:", error);
            setStatus(`Không tải được trạng thái ACE: ${error.message}`);
        }
    };

    launcher.addEventListener("click", () => setOpen(panel.hidden));
    minimizeButton.addEventListener("click", () => setOpen(false));
    historyToggle.addEventListener("click", () => setHistoryView(historyView.hidden));
    resetButton.addEventListener("click", async () => {
        if (!widgetStateLoaded) return;
        setComposerEnabled(false);
        setStatus("Đang đặt lại trạng thái chatbot...");
        try {
            await persistWidgetState(true);
            input.value = "";
            messages.innerHTML = initialMessages;
            setHistoryView(false);
            setStatus("");
        } catch (error) {
            console.error("Không thể đặt lại trạng thái chatbot ACE:", error);
            setStatus(`Không đặt lại được trạng thái ACE: ${error.message}`);
        } finally {
            setComposerEnabled(true);
        }
    });
    widget.addEventListener("click", event => {
        if (!(event.target instanceof Element)) return;
        const promptButton = event.target.closest("[data-prompt]");
        if (!promptButton || !widget.contains(promptButton)) return;
        input.value = promptButton.dataset.prompt || "";
        setStatus("");
        input.focus();
    });
    input.addEventListener("input", () => setStatus(""));
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!widgetStateLoaded || !input.value.trim()) return;
        setStatus("ACE chưa kết nối AI nên tin nhắn chưa được gửi hoặc lưu.");
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) setOpen(false);
    });
    historyEmpty.hidden = false;
    loadWidgetState();
}

window.loadAppUser = async function () {
    const client = window.supabaseClient;
    if (!client) {
        throw new Error("Không tìm thấy kết nối Supabase.");
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
        console.warn("Lỗi kiểm tra phiên làm việc:", sessionError);
        return null;
    }
    if (!sessionData?.session) {
        window.location.replace("login.html");
        return null;
    }

    let user = sessionData.session.user;
    if (!user) {
        try {
            const { data, error: authError } = await client.auth.getUser();
            if (!authError && data?.user) {
                user = data.user;
            }
        } catch (e) {
            console.warn("Lỗi xác thực getUser:", e);
        }
    }
    if (!user) {
        window.location.replace("login.html");
        return null;
    }

    let membership = null;
    let { data, error: membershipError } = await client
        .from("team_members")
        .select("member_id, account_role, workspace_id, members(member_label)")
        .eq("user_id", user.id)
        .maybeSingle();

    if (!data && !membershipError) {
        // Tự động gọi RPC ensure_my_workspace để cấp workspace và vai trò Leader cho tài khoản tự đăng ký
        try {
            const { data: wsId, error: rpcError } = await client.rpc("ensure_my_workspace");
            if (!rpcError && wsId) {
                const retry = await client
                    .from("team_members")
                    .select("member_id, account_role, workspace_id, members(member_label)")
                    .eq("user_id", user.id)
                    .maybeSingle();
                if (retry.data) {
                    data = retry.data;
                }
            }
        } catch (e) {
            console.warn("Lỗi gọi ensure_my_workspace:", e);
        }
    }

    if (membershipError) {
        console.error("Không thể tải thông tin thành viên:", membershipError);
    } else {
        membership = data;
    }

    const name = membership?.members?.member_label ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "Thành viên";
    const accountRole = membership?.account_role || user.app_metadata?.role || "leader";
    const normalizedRole = String(accountRole).trim().toLowerCase();
    const roleLabels = {
        leader: "Trưởng nhóm",
        member: "Thành viên"
    };
    const isLeader = normalizedRole === "leader" || user.app_metadata?.role === "leader" || (!membership && true);
    const userInfo = {
        id: user.id,
        memberId: membership?.member_id || null,
        workspaceId: membership?.workspace_id || null,
        email: user.email || "",
        name,
        role: roleLabels[normalizedRole] || (accountRole ? String(accountRole) : "Trưởng nhóm"),
        accountRole: normalizedRole || "leader",
        isLeader
    };

    window.appUser = userInfo;
    window.renderAppUser(userInfo);
    return userInfo;
};

const personalWorkspaceRequests = new Map();
window.ensurePersonalWorkspace = function (user) {
    if (!user?.id || !window.supabaseClient?.from) {
        return Promise.reject(new Error("Không thể xác định tài khoản để tải workspace."));
    }

    const cachedRequest = personalWorkspaceRequests.get(user.id);
    if (cachedRequest) return cachedRequest;

    const request = (async () => {
        const client = window.supabaseClient;
        let memberId = user.memberId || null;
        let workspaceId = user.workspaceId || null;
        if (!memberId || !workspaceId) {
            const { data: membership, error: membershipError } = await client
                .from("team_members")
                .select("member_id, workspace_id")
                .eq("user_id", user.id)
                .maybeSingle();
            if (membershipError) throw membershipError;
            memberId = membership?.member_id || null;
            workspaceId = membership?.workspace_id || null;
        }
        if (!workspaceId) {
            try {
                const { data: ensuredWsId } = await client.rpc("ensure_my_workspace");
                if (ensuredWsId) {
                    workspaceId = ensuredWsId;
                }
            } catch (rpcErr) {
                console.warn("RPC ensure_my_workspace:", rpcErr);
            }
        }
        if (workspaceId) {
            const { data: workspace, error: workspaceError } = await client
                .from("workspaces")
                .select("workspace_id, workspace_name, created_by, created_at")
                .eq("workspace_id", workspaceId)
                .maybeSingle();
            if (workspaceError) throw workspaceError;
            if (!workspace) {
                throw new Error("Không tìm thấy workspace được liên kết với tài khoản.");
            }
            window.personalWorkspace = workspace;
            return workspace;
        }
        const findAcceptedInvitations = async query => {
            const { data, error } = await query
                .eq("status", "accepted")
                .order("responded_at", { ascending: false })
                .limit(1);
            if (error) throw error;
            return data || [];
        };

        let acceptedInvitations = [];
        if (memberId) {
            acceptedInvitations = await findAcceptedInvitations(client
                .from("workspace_invitations")
                .select("workspace_id")
                .eq("member_id", memberId));
        }
        if (!acceptedInvitations.length && user.email) {
            acceptedInvitations = await findAcceptedInvitations(client
                .from("workspace_invitations")
                .select("workspace_id")
                .eq("email", String(user.email).trim().toLowerCase()));
        }

        if (acceptedInvitations.length) {
            const { data: invitedWorkspace, error: invitedWorkspaceError } = await client
                .from("workspaces")
                .select("workspace_id, workspace_name, created_by, created_at")
                .eq("workspace_id", acceptedInvitations[0].workspace_id)
                .maybeSingle();
            if (invitedWorkspaceError) throw invitedWorkspaceError;
            if (!invitedWorkspace) {
                throw new Error("Không tìm thấy workspace của lời mời đã chấp nhận.");
            }
            window.personalWorkspace = invitedWorkspace;
            return invitedWorkspace;
        }

        const { data: existingWorkspaces, error: workspaceError } = await client
            .from("workspaces")
            .select("workspace_id, workspace_name, created_by, created_at")
            .eq("created_by", user.id)
            .order("created_at", { ascending: true })
            .limit(1);
        if (workspaceError) throw workspaceError;

        if (existingWorkspaces?.length) {
            window.personalWorkspace = existingWorkspaces[0];
            return existingWorkspaces[0];
        }

        const ownerName = user.name || user.email?.split("@")[0] || "của tôi";
        const { data: createdWorkspace, error: createError } = await client
            .from("workspaces")
            .insert({
                workspace_name: `Workspace của ${ownerName}`.slice(0, 100),
                created_by: user.id
            })
            .select("workspace_id, workspace_name, created_by, created_at")
            .single();
        if (createError) throw createError;
        if (!createdWorkspace?.workspace_id) {
            throw new Error("Database chưa trả về workspace cá nhân vừa tạo.");
        }

        window.personalWorkspace = createdWorkspace;
        return createdWorkspace;
    })();

    personalWorkspaceRequests.set(user.id, request);
    return request.catch(error => {
        personalWorkspaceRequests.delete(user.id);
        throw error;
    });
};

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("sidebar-container");
    if (!container) return;

    try {
        const response = await fetch("../components/sidebar.html");
        if (!response.ok) {
            throw new Error(`Không thể tải sidebar: HTTP ${response.status}`);
        }

        container.innerHTML = await response.text();

        window.loadChatHistory();
        window.AppTheme?.refreshToggleButton();

        const currentPage = location.pathname
            .split("/")
            .pop()
            .replace(".html", "");
        container.querySelectorAll(".menu-item").forEach(item => {
            item.classList.toggle("active", item.dataset.page === currentPage);
        });

        if (window.lucide) window.lucide.createIcons();
        const user = await window.loadAppUser();
        if (user) {
            initializeAceChatbot(container, user);
            window.renderAppUser(user);
            try {
                await window.ensurePersonalWorkspace(user);
            } catch (workspaceError) {
                console.error("Không thể tải workspace cá nhân:", workspaceError);
            }
            await initializeAppNotificationCenter(user, container);
        }

        container.querySelector(".setting-button")?.addEventListener("click", () => {
            location.href = "setting.html";
        });
    } catch (error) {
        console.error("Không thể khởi tạo sidebar:", error);
        container.innerHTML = "<p>Không thể tải thanh điều hướng.</p>";
    }
});
