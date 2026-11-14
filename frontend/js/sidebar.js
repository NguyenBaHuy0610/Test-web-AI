function getUserInitials(name = "") {
    return name.trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map(part => part[0])
        .join("")
        .toUpperCase();
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

    const wsElement = document.querySelector(".workspace-name");
    if (wsElement && user.workspaceName) {
        wsElement.textContent = String(user.workspaceName).toUpperCase();
    }
};

let _appUserPromise = null;

window.loadAppUser = async function (forceRefresh = false) {
    if (!forceRefresh && window.appUser) {
        return window.appUser;
    }
    if (!forceRefresh && _appUserPromise) {
        return _appUserPromise;
    }

    _appUserPromise = (async () => {
        try {
            const client = window.supabaseClient;
            if (!client) {
                throw new Error("Không tìm thấy kết nối Supabase.");
            }

            const { data: sessionData, error: sessionError } = await client.auth.getSession();
            if (sessionError) throw sessionError;
            if (!sessionData?.session?.user) {
                window.location.replace("login.html");
                return null;
            }

            const user = sessionData.session.user;

            let membership = null;
            // 1. Tải thông tin cốt lõi từ team_members (không phụ thuộc cột ngoại lai hay join nhúng)
            let { data, error: membershipError } = await client
                .from("team_members")
                .select("member_id, account_role, workspace_id")
                .eq("user_id", user.id)
                .maybeSingle();

            if (membershipError) {
                console.error("Không thể tải thông tin thành viên:", membershipError);
            } else if (data) {
                membership = data;
                // Nếu có member_id, thử lấy tên thành viên từ bảng members
                if (data.member_id) {
                    try {
                        const { data: memberRecord } = await client
                            .from("members")
                            .select("member_label")
                            .eq("member_id", data.member_id)
                            .maybeSingle();
                        if (memberRecord) {
                            membership.members = memberRecord;
                        }
                    } catch (e) {
                        console.warn("Không thể tải nhãn thành viên:", e);
                    }
                }
            }

            // Tự phục hồi workspace nếu user chưa có workspace_id
            if (!membership?.workspace_id) {
                try {
                    const { data: healedWsId } = await client.rpc("ensure_my_workspace");
                    if (healedWsId) {
                        const { data: refetched } = await client
                            .from("team_members")
                            .select("member_id, account_role, workspace_id")
                            .eq("user_id", user.id)
                            .maybeSingle();
                        if (refetched) membership = refetched;
                    }
                } catch (e) {
                    // Không có RPC ensure_my_workspace hoặc lỗi thì bỏ qua
                }
            }

            const workspaceId = membership?.workspace_id || null;
            let workspaceName = "Không gian Multimedia";
            if (workspaceId) {
                try {
                    const { data: wsData } = await client
                        .from("workspaces")
                        .select("workspace_id, workspace_name")
                        .eq("workspace_id", workspaceId)
                        .maybeSingle();
                    if (wsData?.workspace_name) {
                        workspaceName = wsData.workspace_name;
                    }
                } catch (e) {
                    // Dự phòng nếu bảng workspaces chưa tạo RLS
                    workspaceName = `Workspace ${workspaceId}`;
                }
            }

            const name = user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                membership?.members?.member_label ||
                user.email?.split("@")[0] ||
                "Thành viên";
            const accountRole = membership?.account_role || user.app_metadata?.role || "";
            const normalizedRole = String(accountRole).trim().toLowerCase();
            const roleLabels = {
                leader: "Trưởng nhóm",
                member: "Thành viên"
            };
            const userInfo = {
                id: user.id,
                email: user.email || "",
                name,
                role: roleLabels[normalizedRole] ||
                    (accountRole ? String(accountRole) : membershipError ? "Không tải được vai trò" : "Chưa gán vai trò"),
                accountRole: normalizedRole,
                isLeader: normalizedRole === "leader",
                memberId: membership?.member_id || user.user_metadata?.member_id || user.app_metadata?.member_id || null,
                memberLabel: membership?.members?.member_label || name,
                department: membership?.members?.department || null,
                workspaceId,
                workspaceName
            };

            window.appUser = userInfo;
            window.renderAppUser(userInfo);
            return userInfo;
        } finally {
            _appUserPromise = null;
        }
    })();

    return _appUserPromise;
};

const CHAT_HISTORY_TABLE = "ai_conversations";
const CHAT_HISTORY_LIMIT = 20;
const inFlightChatSync = new Map();
let missingChatTableWarned = false;

function toIsoStringIfDate(value) {
    if (!value) return value ?? null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    return value;
}

function reviveDateValue(value) {
    if (!value) return value ?? null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function serializePlanData(plan) {
    if (!plan || typeof plan !== "object") return null;

    const event = plan.event && typeof plan.event === "object"
        ? {
            ...plan.event,
            plan_start: toIsoStringIfDate(plan.event.plan_start),
            event_start: toIsoStringIfDate(plan.event.event_start),
            event_end: toIsoStringIfDate(plan.event.event_end)
        }
        : plan.event;

    const tasks = Array.isArray(plan.tasks)
        ? plan.tasks.map(t => ({
            ...t,
            on_air: toIsoStringIfDate(t.on_air),
            deadline: toIsoStringIfDate(t.deadline),
            feedback_due: toIsoStringIfDate(t.feedback_due)
        }))
        : [];

    return {
        ...plan,
        event,
        tasks,
        isSaved: Boolean(plan.isSaved),
        savedResult: plan.savedResult ? { ...plan.savedResult } : null
    };
}

function revivePlanData(plan) {
    if (!plan || typeof plan !== "object") return null;

    const event = plan.event && typeof plan.event === "object"
        ? {
            ...plan.event,
            plan_start: reviveDateValue(plan.event.plan_start),
            event_start: reviveDateValue(plan.event.event_start),
            event_end: reviveDateValue(plan.event.event_end)
        }
        : plan.event;

    const tasks = Array.isArray(plan.tasks)
        ? plan.tasks.map(t => ({
            ...t,
            on_air: reviveDateValue(t.on_air),
            deadline: reviveDateValue(t.deadline),
            feedback_due: reviveDateValue(t.feedback_due)
        }))
        : [];

    return {
        ...plan,
        event,
        tasks,
        isSaved: Boolean(plan.isSaved),
        savedResult: plan.savedResult ? { ...plan.savedResult } : null
    };
}

function serializeAttachments(attachments) {
    if (!Array.isArray(attachments)) return [];
    return attachments
        .filter(att => att && att.status !== "error")
        .map(att => ({
            id: att.id || null,
            name: att.name || "Tệp đính kèm",
            size: Number(att.size) || 0,
            mimeType: att.mimeType || "",
            ext: att.ext || "",
            kind: att.kind || "document",
            extractedText: typeof att.extractedText === "string" ? att.extractedText : "",
            charCount: Number(att.charCount) || 0,
            truncated: Boolean(att.truncated),
            thumbnailUrl: att.thumbnailUrl || null
        }));
}

function serializeMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(m => {
        const serialized = {
            role: m?.role || "assistant",
            content: typeof m?.content === "string" ? m.content : String(m?.content || "")
        };
        if (m?.planData) {
            serialized.planData = serializePlanData(m.planData);
        }
        if (Array.isArray(m?.attachments) && m.attachments.length > 0) {
            const cleanAtts = serializeAttachments(m.attachments);
            if (cleanAtts.length > 0) {
                serialized.attachments = cleanAtts;
            }
        }
        return serialized;
    });
}

function reviveMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(m => {
        const revived = {
            role: m?.role || "assistant",
            content: typeof m?.content === "string" ? m.content : String(m?.content || "")
        };
        if (m?.planData) {
            revived.planData = revivePlanData(m.planData);
        }
        if (Array.isArray(m?.attachments) && m.attachments.length > 0) {
            revived.attachments = serializeAttachments(m.attachments);
        }
        return revived;
    });
}

function isMissingChatTableError(error) {
    const msg = String(error?.message || error?.details || "").toLowerCase();
    return error?.code === "PGRST205" || error?.status === 404 || msg.includes("could not find the table") || msg.includes("does not exist");
}

function warnMissingChatTableOnce() {
    if (missingChatTableWarned) return;
    missingChatTableWarned = true;
    console.warn("Bảng Supabase ai_conversations chưa tồn tại. Hãy chạy file supabase/ai_conversations.sql trong Supabase SQL Editor để đồng bộ đa thiết bị.");
}

function getConversationTimestamp(conv) {
    const ms = Date.parse(conv?.updatedAt || conv?.updated_at || "");
    return Number.isNaN(ms) ? 0 : ms;
}

function normalizeStoredConversation(conv) {
    if (!conv || !conv.id) return null;
    return {
        id: String(conv.id),
        title: conv.title || "Cuộc trò chuyện",
        updatedAt: conv.updatedAt || conv.updated_at || new Date().toISOString(),
        activeEventId: conv.activeEventId ?? conv.active_event_id ?? null,
        messages: serializeMessages(conv.messages)
    };
}

function sortAndTrimConversations(list) {
    return list
        .filter(Boolean)
        .sort((a, b) => getConversationTimestamp(b) - getConversationTimestamp(a))
        .slice(0, CHAT_HISTORY_LIMIT);
}

window.ChatHistoryStore = {
    serializeAttachments,
    serializePlanData,
    revivePlanData,
    serializeMessages,
    reviveMessages,

    getStorageKey(userId) {
        return userId ? `mediatask_conversations_${userId}` : null;
    },

    async resolveUserId(explicitUserId) {
        if (explicitUserId) return explicitUserId;
        if (window.appUser?.id) return window.appUser.id;
        if (typeof window.loadAppUser === "function") {
            const user = await window.loadAppUser();
            return user?.id || null;
        }
        return null;
    },

    getLocalConversations(userIdOverride) {
        const userId = userIdOverride || window.appUser?.id || null;
        const key = this.getStorageKey(userId);
        if (!key) return [];

        try {
            const raw = JSON.parse(localStorage.getItem(key) || "[]");
            if (!Array.isArray(raw)) return [];
            return sortAndTrimConversations(raw.map(normalizeStoredConversation));
        } catch {
            return [];
        }
    },

    setLocalConversations(userId, conversations) {
        const key = this.getStorageKey(userId);
        if (!key) return;

        try {
            const normalized = sortAndTrimConversations((conversations || []).map(normalizeStoredConversation));
            localStorage.setItem(key, JSON.stringify(normalized));
        } catch (err) {
            console.warn("Không thể ghi cache lịch sử chat:", err);
        }
    },

    async upsertToSupabase(userId, conversation) {
        const client = window.supabaseClient;
        if (!client || !userId || !conversation?.id) return false;

        try {
            const payload = {
                id: String(conversation.id),
                user_id: userId,
                title: conversation.title || "Cuộc trò chuyện",
                messages: serializeMessages(conversation.messages),
                active_event_id: conversation.activeEventId ?? null,
                updated_at: conversation.updatedAt || new Date().toISOString()
            };

            const { error } = await client
                .from(CHAT_HISTORY_TABLE)
                .upsert(payload, { onConflict: "user_id,id" });

            if (error) {
                if (isMissingChatTableError(error)) {
                    warnMissingChatTableOnce();
                } else {
                    console.warn("Không thể đồng bộ cuộc trò chuyện lên Supabase:", error.message || error);
                }
                return false;
            }
            return true;
        } catch (err) {
            console.warn("Lỗi đồng bộ cuộc trò chuyện lên Supabase:", err);
            return false;
        }
    },

    async saveConversation(conversation, userIdOverride) {
        const normalized = normalizeStoredConversation(conversation);
        if (!normalized) return null;

        const userId = await this.resolveUserId(userIdOverride || conversation?.userId);
        if (!userId) return normalized;

        const current = this.getLocalConversations(userId).filter(c => c.id !== normalized.id);
        current.unshift(normalized);
        this.setLocalConversations(userId, current);

        if (typeof window.renderSidebarChatHistory === "function") {
            window.renderSidebarChatHistory(userId);
        }

        await this.upsertToSupabase(userId, normalized);
        return normalized;
    },

    async syncFromSupabase(userIdOverride) {
        const userId = await this.resolveUserId(userIdOverride);
        if (!userId) return [];

        if (inFlightChatSync.has(userId)) {
            return inFlightChatSync.get(userId);
        }

        const task = (async () => {
            const localList = this.getLocalConversations(userId);
            const client = window.supabaseClient;
            if (!client) return localList;

            try {
                const { data, error } = await client
                    .from(CHAT_HISTORY_TABLE)
                    .select("id, user_id, title, messages, active_event_id, updated_at")
                    .eq("user_id", userId)
                    .order("updated_at", { ascending: false })
                    .limit(CHAT_HISTORY_LIMIT);

                if (error) {
                    if (isMissingChatTableError(error)) {
                        warnMissingChatTableOnce();
                    } else {
                        console.warn("Không thể tải lịch sử chat từ Supabase:", error.message || error);
                    }
                    return localList;
                }

                const remoteList = (data || []).map(row => normalizeStoredConversation({
                    id: row.id,
                    title: row.title,
                    updatedAt: row.updated_at,
                    activeEventId: row.active_event_id,
                    messages: row.messages
                })).filter(Boolean);

                const mergedById = new Map();
                remoteList.forEach(item => mergedById.set(item.id, item));

                const pendingUploads = [];
                localList.forEach(localItem => {
                    const remoteItem = mergedById.get(localItem.id);
                    if (!remoteItem || getConversationTimestamp(localItem) > getConversationTimestamp(remoteItem)) {
                        mergedById.set(localItem.id, localItem);
                        pendingUploads.push(localItem);
                    }
                });

                const merged = sortAndTrimConversations(Array.from(mergedById.values()));
                this.setLocalConversations(userId, merged);

                if (pendingUploads.length > 0) {
                    Promise.allSettled(pendingUploads.map(item => this.upsertToSupabase(userId, item)));
                }

                return merged;
            } catch (err) {
                console.warn("Lỗi đồng bộ lịch sử chat từ Supabase:", err);
                return localList;
            } finally {
                inFlightChatSync.delete(userId);
            }
        })();

        inFlightChatSync.set(userId, task);
        return task;
    }
};

window.syncChatHistoryForUser = function (userOrId) {
    const userId = typeof userOrId === "string" ? userOrId : userOrId?.id;
    return window.ChatHistoryStore.syncFromSupabase(userId);
};

window.renderSidebarChatHistory = function (userIdOverride) {
    const section = document.getElementById("chatHistorySection");
    const list = document.getElementById("chatHistoryList");
    if (!section || !list) return;

    const userId = userIdOverride || window.appUser?.id || null;
    const conversations = userId ? window.ChatHistoryStore.getLocalConversations(userId) : [];

    list.innerHTML = "";
    section.hidden = !conversations?.length;
    if (!conversations?.length) return;

    conversations.forEach(conversation => {
        const item = document.createElement("div");
        item.className = "chat-history-item";
        if (window._activeConversationId && window._activeConversationId === conversation.id) {
            item.classList.add("active");
        }
        item.dataset.id = conversation.id;
        item.style.cursor = "pointer";

        const icon = document.createElement("i");
        icon.setAttribute("data-lucide", "message-square");

        const title = document.createElement("span");
        title.textContent = conversation.title || "Cuộc trò chuyện";

        item.append(icon, title);

        item.addEventListener("click", () => {
            if (typeof window.openConversation === "function") {
                window.openConversation(conversation.id);
            } else {
                location.href = `dashboard.html?conv=${encodeURIComponent(conversation.id)}`;
            }
        });

        list.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
};

function loadExternalScriptOnce(id, src) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.id = id;
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.body.appendChild(script);
    });
}

async function ensureSupportWidgetLoaded(user) {
    if (!user) return;
    if (!document.getElementById("aecpt-support-widget-css")) {
        const link = document.createElement("link");
        link.id = "aecpt-support-widget-css";
        link.rel = "stylesheet";
        link.href = "../styles/support-widget.css";
        document.head.appendChild(link);
    }
    if (!window.APP_CONFIG) {
        await loadExternalScriptOnce("aecpt-config-js", "../config.js");
    }
    await loadExternalScriptOnce("aecpt-support-widget-js", "../js/support-widget.js");
    if (typeof window.initSupportWidget === "function") {
        await window.initSupportWidget(user);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("sidebar-container");
    if (!container) return;

    try {
        const response = await fetch("../components/sidebar.html");
        if (!response.ok) {
            throw new Error(`Không thể tải sidebar: HTTP ${response.status}`);
        }

        container.innerHTML = await response.text();

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
            window.renderAppUser(user);
            window.renderSidebarChatHistory(user.id);
            await window.ChatHistoryStore.syncFromSupabase(user.id);
            window.renderSidebarChatHistory(user.id);
            ensureSupportWidgetLoaded(user).catch(err => {
                console.warn("Không thể khởi tạo Bảo mẫu AECPT:", err);
            });
        } else {
            window.renderSidebarChatHistory(null);
        }

        container.querySelector(".setting-button")?.addEventListener("click", () => {
            location.href = "setting.html";
        });
    } catch (error) {
        console.error("Không thể khởi tạo sidebar:", error);
        container.innerHTML = "<p>Không thể tải thanh điều hướng.</p>";
    }
});
