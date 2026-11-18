/**
 * task-comments.js
 * Hệ thống bình luận dạng Facebook cho từng công việc (AECPT Task Tracker).
 * Tuân thủ tuyệt đối các quyết định của dự án:
 * - 1A: Hiển thị ngay dưới nội dung Popup / Modal chi tiết công việc.
 * - Bình luận thường (không @): Chỉ thông báo qua App (bảng notifications), không gửi email.
 *   + Gốc: Báo người phụ trách chính (primary) + tất cả Trưởng ban (Leader).
 *   + Trả lời (reply): Báo chủ sở hữu của bình luận được trả lời.
 * - 2A: Khi có @mention: Báo qua CẢ App + Email Brevo tức thì.
 * - 3A: Lọc trùng người nhận (1 in-app, 1 email).
 * - 4A: Không thông báo cho chính người viết bình luận.
 * - 5A: Sắp xếp theo trình tự thời gian (cũ nhất ở trên, mới nhất ở dưới).
 * - 5C: Thụt lề tối đa 3 cấp; từ cấp 4 trở đi giữ nguyên lề cấp 3 và tự động gắn tag @TênNgườiĐượcTrảLời.
 * - Sửa / Xoá: Người viết sửa/xoá được bình luận của mình; Trưởng ban xoá được mọi bình luận.
 *   Nếu có câu trả lời con: chuyển thành "Bình luận đã bị xoá" và giữ nguyên cây bình luận con.
 * - Realtime: Tự động cập nhật qua Supabase Realtime khi có bình luận mới/sửa/xoá.
 */

(function () {
    "use strict";

    // Danh sách vai trò / ban hệ thống hỗ trợ @mention
    const SYSTEM_ROLES = [
        { type: "all", role: "all", label: "@all", name: "Tất cả mọi người", sub: "Thông báo cả ban" },
        { type: "role", role: "leader", label: "@leader", name: "Trưởng ban", sub: "Ban Quản lý" },
        { type: "role", role: "content", label: "@content", name: "Ban Nội dung", sub: "Nhóm Content" },
        { type: "role", role: "design", label: "@design", name: "Ban Thiết kế", sub: "Nhóm Design" },
        { type: "role", role: "editor", label: "@editor", name: "Ban Video / Editor", sub: "Nhóm Editor" },
        { type: "role", role: "photo", label: "@photo", name: "Ban Hình ảnh / Photo", sub: "Nhóm Photo" },
        { type: "role", role: "technician", label: "@technician", name: "Ban Kỹ thuật", sub: "Nhóm Technician" }
    ];

    function escapeHTML(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getUserInitials(name) {
        if (!name) return "?";
        const parts = String(name).trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function formatTimeAgo(dateString) {
        if (!dateString) return "";
        const date = new Date(dateString);
        const now = new Date();
        const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffSeconds < 45) return "Vừa xong";
        if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} phút trước`;
        if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} giờ trước`;
        if (diffSeconds < 86400 * 7) return `${Math.floor(diffSeconds / 86400)} ngày trước`;

        return new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function formatRoleClass(role) {
        const normalized = String(role || "").toLowerCase().trim();
        if (["leader", "trưởng ban", "trưởng nhóm"].includes(normalized)) return "role-badge-leader";
        if (["content", "nội dung"].includes(normalized)) return "role-badge-content";
        if (["design", "thiết kế"].includes(normalized)) return "role-badge-design";
        if (["editor", "video", "dựng"].includes(normalized)) return "role-badge-editor";
        if (["photo", "ảnh", "nhiếp ảnh"].includes(normalized)) return "role-badge-photo";
        if (["technician", "kỹ thuật"].includes(normalized)) return "role-badge-technician";
        return "role-badge-member";
    }

    function formatRoleLabel(role) {
        const normalized = String(role || "").toLowerCase().trim();
        if (["leader", "trưởng ban", "trưởng nhóm"].includes(normalized)) return "Trưởng ban";
        if (["content", "nội dung"].includes(normalized)) return "Content";
        if (["design", "thiết kế"].includes(normalized)) return "Design";
        if (["editor", "video", "dựng"].includes(normalized)) return "Editor";
        if (["photo", "ảnh", "nhiếp ảnh"].includes(normalized)) return "Photo";
        if (["technician", "kỹ thuật"].includes(normalized)) return "Kỹ thuật";
        return role || "Thành viên";
    }

    function renderFormattedContent(text, mentions = []) {
        if (!text) return "";
        let safe = escapeHTML(text);

        // Highlight @all
        safe = safe.replace(/@all\b/gi, '<span class="mention-tag mention-tag-all">@all</span>');

        // Highlight @roles
        SYSTEM_ROLES.forEach(r => {
            if (r.role !== "all") {
                const regex = new RegExp(`@${r.role}\\b`, "gi");
                safe = safe.replace(regex, `<span class="mention-tag">${r.label}</span>`);
            }
        });

        // Gom danh sách tên thành viên cần highlight (từ workspaceMembers và mentions của comment)
        const nameSet = new Set();
        workspaceMembers.forEach(m => { if (m.name) nameSet.add(m.name); });
        if (Array.isArray(mentions)) {
            mentions.forEach(m => { if (m && m.name) nameSet.add(m.name); });
        }

        // Sắp xếp tên dài trước để ưu tiên match tên đầy đủ trước
        const sortedNames = Array.from(nameSet).sort((a, b) => b.length - a.length);
        sortedNames.forEach(name => {
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`@${escapedName}(?=[\\s,.:;!?)]|$)`, "gi");
            safe = safe.replace(regex, `<span class="mention-tag">@${escapeHTML(name)}</span>`);
        });

        return safe;
    }

    // Trạng thái của instance hiện tại
    let currentTaskId = null;
    let currentContainer = null;
    let currentTaskInfo = {};
    let activeChannel = null;
    let commentsData = [];
    let workspaceMembers = [];
    let replyingToComment = null; // object bình luận đang phản hồi
    let editingCommentId = null;  // id bình luận đang chỉnh sửa
    let activeMentionsList = [];  // danh sách mentions thu thập cho composer hiện tại

    /**
     * Tải danh sách thành viên trong Workspace để hỗ trợ autocomplete @mention
     */
    async function loadWorkspaceMembers(client, workspaceId) {
        try {
            if (!workspaceId) return [];

            const [membersRes, teamRes] = await Promise.all([
                client
                    .from("members")
                    .select("member_id, member_label, email")
                    .eq("workspace_id", workspaceId),
                client
                    .from("team_members")
                    .select("user_id, member_id, account_role")
                    .eq("workspace_id", workspaceId)
            ]);

            const members = membersRes.data || [];
            const team = teamRes.data || [];
            const userMap = new Map();
            team.forEach(t => {
                if (t.member_id) userMap.set(String(t.member_id), t);
            });

            return members.map(m => {
                const tm = userMap.get(String(m.member_id));
                return {
                    type: "user",
                    member_id: m.member_id,
                    user_id: tm?.user_id || null,
                    name: m.member_label || "Thành viên",
                    email: m.email || "",
                    role: tm?.account_role || "member",
                    sub: formatRoleLabel(tm?.account_role || "Thành viên")
                };
            }).filter(m => m.user_id != null);
        } catch (error) {
            console.warn("Không thể tải danh sách thành viên workspace cho bình luận:", error);
            return [];
        }
    }

    /**
     * Lấy thông tin tài khoản hiện tại
     */
    async function getCurrentUserInfo(client) {
        try {
            if (window.appUser && window.appUser.id) {
                return window.appUser;
            }

            const { data: { session } } = await client.auth.getSession();
            if (!session?.user) return null;

            const user = session.user;
            const { data: membership } = await client
                .from("team_members")
                .select("member_id, account_role, workspace_id, members(member_label)")
                .eq("user_id", user.id)
                .maybeSingle();

            const accountRole = membership?.account_role || user.app_metadata?.role || "member";
            const isLeader = ["leader", "team_leader", "trưởng nhóm", "trưởng ban"].includes(
                String(accountRole).toLowerCase().trim()
            );

            return {
                id: user.id,
                memberId: membership?.member_id || null,
                workspaceId: membership?.workspace_id || null,
                email: user.email || "",
                name: membership?.members?.member_label || user.user_metadata?.full_name || user.email?.split("@")[0] || "Tôi",
                role: formatRoleLabel(accountRole),
                accountRole: accountRole,
                isLeader: isLeader
            };
        } catch (err) {
            console.error("Lỗi lấy thông tin người dùng:", err);
            return null;
        }
    }

    /**
     * Tải danh sách bình luận cho task
     * Sắp xếp: Cũ nhất ở trên, mới nhất ở dưới cùng (Rule 5A)
     */
    async function fetchTaskComments(client, taskId) {
        const { data, error } = await client
            .from("task_comments")
            .select("*")
            .eq("task_id", taskId)
            .order("created_at", { ascending: true }); // Rule 5A

        if (error) {
            console.error("Lỗi tải bình luận:", error);
            return [];
        }
        return data || [];
    }

    /**
     * Dựng cây bình luận theo thứ tự phân cấp
     * Áp dụng Rule 5C: Thụt lề tối đa 3 cấp; từ cấp 4 trở đi giữ nguyên lề cấp 3
     */
    function buildCommentTree(comments) {
        const map = new Map();
        comments.forEach(c => {
            map.set(c.comment_id, {
                ...c,
                children: [],
                logicalDepth: 1,
                visualDepth: 1
            });
        });

        const roots = [];
        comments.forEach(c => {
            const node = map.get(c.comment_id);
            if (c.parent_id && map.has(c.parent_id)) {
                map.get(c.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        });

        function assignDepths(node, depth) {
            node.logicalDepth = depth;
            node.visualDepth = Math.min(depth, 3); // Capped at depth 3
            node.children.forEach(child => assignDepths(child, depth + 1));
        }

        roots.forEach(root => assignDepths(root, 1));
        return roots;
    }

    /**
     * Render HTML cho từng node bình luận và các câu trả lời con đệ quy
     */
    function renderCommentNode(node, currentUser) {
        const isAuthor = currentUser && String(currentUser.id) === String(node.user_id);
        const canDelete = isAuthor || (currentUser && currentUser.isLeader);
        const canEdit = isAuthor && !node.is_deleted;
        const depthClass = node.visualDepth === 1
            ? "depth-1"
            : node.visualDepth === 2
                ? "depth-2"
                : node.visualDepth === 3 && node.logicalDepth === 3
                    ? "depth-3"
                    : "depth-max";

        const isCurrentlyEditing = editingCommentId === node.comment_id;
        const isReplyingToThis = replyingToComment && replyingToComment.comment_id === node.comment_id;

        const roleBadgeClass = formatRoleClass(node.author_role);
        const roleLabel = formatRoleLabel(node.author_role);

        let contentHTML = "";
        if (node.is_deleted) {
            contentHTML = `<p class="comment-text is-deleted"><i data-lucide="info" style="width:12px;height:12px;vertical-align:middle;margin-right:4px;"></i>Bình luận đã bị xoá</p>`;
        } else if (isCurrentlyEditing) {
            contentHTML = `
                <div class="comment-edit-box" data-edit-comment-id="${node.comment_id}">
                    <textarea class="comment-edit-input" id="editCommentInput_${node.comment_id}">${escapeHTML(node.content)}</textarea>
                    <div class="comment-edit-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-cancel-edit>Hủy</button>
                        <button type="button" class="btn btn-primary btn-sm" data-save-edit="${node.comment_id}">Lưu thay đổi</button>
                    </div>
                </div>
            `;
        } else {
            contentHTML = `<div class="comment-text">${renderFormattedContent(node.content, node.mentions)}</div>`;
        }

        // Actions: Phản hồi, Sửa, Xoá
        let actionsHTML = "";
        if (!node.is_deleted && !isCurrentlyEditing) {
            actionsHTML = `
                <div class="comment-actions-bar">
                    <span class="comment-time">${formatTimeAgo(node.created_at)}</span>
                    <button type="button" class="comment-action-btn" data-reply-btn="${node.comment_id}">Phản hồi</button>
                    ${canEdit ? `<button type="button" class="comment-action-btn" data-edit-btn="${node.comment_id}">Sửa</button>` : ""}
                    ${canDelete ? `<button type="button" class="comment-action-btn btn-delete" data-delete-btn="${node.comment_id}">Xoá</button>` : ""}
                </div>
            `;
        } else if (node.is_deleted) {
            actionsHTML = `
                <div class="comment-actions-bar">
                    <span class="comment-time">${formatTimeAgo(node.created_at)}</span>
                </div>
            `;
        }

        // Reply Composer khi người dùng bấm "Phản hồi" tại comment này
        let replyComposerHTML = "";
        if (isReplyingToThis) {
            const targetAuthorName = node.author_name;
            replyComposerHTML = `
                <div class="reply-composer-wrap" id="replyComposer_${node.comment_id}">
                    <div class="reply-target-indicator">
                        <span>Đang trả lời <strong>@${escapeHTML(targetAuthorName)}</strong></span>
                        <button type="button" class="reply-cancel-btn" data-cancel-reply>Hủy bỏ</button>
                    </div>
                    <div class="comment-composer">
                        <div class="comment-avatar">
                            ${currentUser ? getUserInitials(currentUser.name) : "?"}
                        </div>
                        <div class="composer-input-wrapper">
                            <textarea 
                                class="comment-textarea reply-textarea" 
                                id="replyTextarea_${node.comment_id}" 
                                placeholder="Viết phản hồi... (gõ @ để nhắc tên)"
                                rows="1"
                                data-parent-id="${node.comment_id}"
                            ></textarea>
                            <button type="button" class="composer-send-btn" data-send-reply="${node.comment_id}" aria-label="Gửi phản hồi">
                                <i data-lucide="send"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        // Render các con đệ quy
        const childrenHTML = node.children && node.children.length > 0
            ? node.children.map(child => renderCommentNode(child, currentUser)).join("")
            : "";

        return `
            <div class="comment-item ${depthClass}" id="commentItem_${node.comment_id}" data-comment-id="${node.comment_id}">
                <div class="comment-node">
                    <div class="comment-avatar ${node.is_deleted ? 'avatar-deleted' : ''}">
                        ${node.is_deleted ? '?' : (node.author_avatar ? `<img src="${escapeHTML(node.author_avatar)}" alt="${escapeHTML(node.author_name)}" />` : getUserInitials(node.author_name))}
                    </div>
                    <div class="comment-bubble-wrap">
                        <div class="comment-bubble ${node.is_deleted ? 'is-deleted' : ''}">
                            <div class="comment-author-row">
                                <span class="comment-author-name">${escapeHTML(node.is_deleted ? 'Thành viên' : node.author_name)}</span>
                                ${!node.is_deleted && node.author_role ? `<span class="comment-role-badge ${roleBadgeClass}">${escapeHTML(roleLabel)}</span>` : ""}
                            </div>
                            ${contentHTML}
                        </div>
                        ${actionsHTML}
                    </div>
                </div>
                ${replyComposerHTML}
                ${childrenHTML}
            </div>
        `;
    }

    /**
     * Render toàn bộ khối bình luận Facebook vào container
     */
    async function renderCommentsUI() {
        if (!currentContainer) return;

        const client = window.supabaseClient;
        const currentUser = await getCurrentUserInfo(client);
        const roots = buildCommentTree(commentsData);
        const totalCount = commentsData.filter(c => !c.is_deleted).length;

        const listContentHTML = roots.length > 0
            ? roots.map(root => renderCommentNode(root, currentUser)).join("")
            : `<div class="comment-empty-state"><i data-lucide="message-square-dashed" style="width:24px;height:24px;margin-bottom:6px;display:block;margin-left:auto;margin-right:auto;color:#94a3b8;"></i>Chưa có bình luận nào. Hãy là người đầu tiên trao đổi về công việc này!</div>`;

        currentContainer.innerHTML = `
            <div class="task-comments-wrapper" id="taskCommentsWrapper">
                <div class="comments-header">
                    <h3 class="comments-title">
                        <i data-lucide="message-circle"></i>
                        <span>Thảo luận công việc</span>
                        <span class="comments-count-badge" id="commentsCountBadge">${totalCount}</span>
                    </h3>
                </div>

                <div class="comments-list" id="taskCommentsList">
                    ${listContentHTML}
                </div>

                <!-- Main Composer: Đặt ở dưới cùng (Rule 5A) -->
                <div class="comment-composer main-composer" id="taskMainComposer">
                    <div class="comment-avatar">
                        ${currentUser ? getUserInitials(currentUser.name) : "?"}
                    </div>
                    <div class="composer-input-wrapper">
                        <textarea 
                            class="comment-textarea" 
                            id="mainCommentTextarea" 
                            placeholder="Viết bình luận... (gõ @ để nhắc tên hoặc ban)" 
                            rows="1"
                        ></textarea>
                        <button type="button" class="composer-send-btn" id="sendMainCommentBtn" aria-label="Gửi bình luận">
                            <i data-lucide="send"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        if (window.lucide) window.lucide.createIcons();

        // Gắn sự kiện cho các composer và autocompletes
        bindCommentEvents(client, currentUser);

        // Nếu đang mở reply composer, tự động focus vào textarea đó
        if (replyingToComment) {
            const replyInput = currentContainer.querySelector(`#replyTextarea_${replyingToComment.comment_id}`);
            if (replyInput) {
                // Rule 5C: Nếu trả lời comment ở cấp >= 3, tự động gắn tag @TênNgườiĐượcTrảLời
                if (replyingToComment.logicalDepth >= 3 && !replyInput.value.includes(`@${replyingToComment.author_name}`)) {
                    replyInput.value = `@${replyingToComment.author_name} `;
                    // Đưa mention này vào activeMentionsList
                    const matchedMember = workspaceMembers.find(m => m.user_id === replyingToComment.user_id);
                    if (matchedMember) {
                        activeMentionsList.push({
                            type: "user",
                            id: matchedMember.user_id,
                            name: matchedMember.name,
                            role: matchedMember.role
                        });
                    }
                }
                replyInput.focus();
                replyInput.setSelectionRange(replyInput.value.length, replyInput.value.length);
                setupMentionAutocomplete(replyInput);
            }
        }

        // Setup autocomplete cho main composer textarea
        const mainInput = currentContainer.querySelector("#mainCommentTextarea");
        if (mainInput) {
            setupMentionAutocomplete(mainInput);
        }

        // Setup autocomplete cho edit textarea nếu có
        if (editingCommentId) {
            const editInput = currentContainer.querySelector(`#editCommentInput_${editingCommentId}`);
            if (editInput) {
                setupMentionAutocomplete(editInput);
                editInput.focus();
                editInput.setSelectionRange(editInput.value.length, editInput.value.length);
            }
        }
    }

    /**
     * Khởi tạo hệ thống Autocomplete @mention cho textarea
     */
    function setupMentionAutocomplete(textarea) {
        if (!textarea) return;

        // Xóa dropdown cũ nếu có
        let dropdown = textarea.parentElement.querySelector(".mentions-dropdown");
        if (!dropdown) {
            dropdown = document.createElement("div");
            dropdown.className = "mentions-dropdown";
            dropdown.hidden = true;
            textarea.parentElement.appendChild(dropdown);
        }

        let currentMentionQuery = null;
        let selectedIndex = -1;
        let matchingOptions = [];

        function closeDropdown() {
            dropdown.hidden = true;
            currentMentionQuery = null;
            selectedIndex = -1;
            matchingOptions = [];
        }

        function renderDropdown(options) {
            matchingOptions = options;
            if (!options.length) {
                closeDropdown();
                return;
            }

            dropdown.innerHTML = "";
            let currentGroup = null;

            options.forEach((opt, idx) => {
                if (opt.group !== currentGroup) {
                    currentGroup = opt.group;
                    const title = document.createElement("div");
                    title.className = "mention-group-title";
                    title.textContent = currentGroup;
                    dropdown.appendChild(title);
                }

                const item = document.createElement("div");
                item.className = `mention-option${idx === selectedIndex ? " is-active" : ""}`;
                item.innerHTML = `
                    <div class="mention-option-avatar">${opt.avatar || (opt.type === "all" ? "📢" : opt.type === "role" ? "👥" : getUserInitials(opt.name))}</div>
                    <span class="mention-option-name">${escapeHTML(opt.label || opt.name)}</span>
                    <span class="mention-option-sub">${escapeHTML(opt.sub || "")}</span>
                `;

                item.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectOption(opt);
                });

                dropdown.appendChild(item);
            });

            dropdown.hidden = false;
        }

        function selectOption(option) {
            const cursorPos = textarea.selectionStart;
            const text = textarea.value;
            const beforeCursor = text.slice(0, cursorPos);
            const afterCursor = text.slice(cursorPos);

            // Tìm vị trí ký tự @ cuối cùng trước con trỏ
            const atIndex = beforeCursor.lastIndexOf("@");
            if (atIndex === -1) return;

            const insertText = (option.label || `@${option.name}`) + " ";
            const newText = beforeCursor.slice(0, atIndex) + insertText + afterCursor;
            textarea.value = newText;

            // Đặt lại vị trí con trỏ ngay sau mention vừa chọn
            const newCursorPos = atIndex + insertText.length;
            textarea.setSelectionRange(newCursorPos, newCursorPos);
            textarea.focus();

            // Lưu mention vào danh sách activeMentionsList
            if (option.type === "all") {
                activeMentionsList.push({ type: "all" });
            } else if (option.type === "role") {
                activeMentionsList.push({ type: "role", role: option.role });
            } else if (option.type === "user") {
                activeMentionsList.push({
                    type: "user",
                    id: option.user_id,
                    name: option.name,
                    role: option.role
                });
            }

            closeDropdown();
        }

        textarea.addEventListener("input", () => {
            // Tự động điều chỉnh chiều cao textarea
            textarea.style.height = "auto";
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";

            const cursorPos = textarea.selectionStart;
            const text = textarea.value.slice(0, cursorPos);
            const atIndex = text.lastIndexOf("@");

            if (atIndex !== -1) {
                // Kiểm tra xem trước @ có khoảng trắng hoặc đầu dòng không
                const charBeforeAt = atIndex > 0 ? text[atIndex - 1] : " ";
                if (charBeforeAt === " " || charBeforeAt === "\n" || atIndex === 0) {
                    const query = text.slice(atIndex + 1).toLowerCase();
                    // Nếu chưa cách khoảng trắng (đang gõ query mention)
                    if (!query.includes("\n") && query.length <= 30) {
                        currentMentionQuery = query;

                        // Lọc các vai trò hệ thống
                        const matchedRoles = SYSTEM_ROLES.filter(r => 
                            r.label.toLowerCase().includes(query) || 
                            r.role.toLowerCase().includes(query) ||
                            r.name.toLowerCase().includes(query)
                        ).map(r => ({ ...r, group: "Vai trò & Ban" }));

                        // Lọc các thành viên workspace
                        const matchedUsers = workspaceMembers.filter(m =>
                            m.name.toLowerCase().includes(query) ||
                            m.sub.toLowerCase().includes(query) ||
                            (m.email && m.email.toLowerCase().includes(query))
                        ).map(m => ({
                            ...m,
                            label: `@${m.name}`,
                            group: "Thành viên"
                        }));

                        const allOptions = [...matchedRoles, ...matchedUsers];
                        selectedIndex = allOptions.length > 0 ? 0 : -1;
                        renderDropdown(allOptions);
                        return;
                    }
                }
            }

            closeDropdown();
        });

        textarea.addEventListener("keydown", (e) => {
            if (dropdown.hidden || !matchingOptions.length) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % matchingOptions.length;
                renderDropdown(matchingOptions);
                scrollOptionIntoView();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + matchingOptions.length) % matchingOptions.length;
                renderDropdown(matchingOptions);
                scrollOptionIntoView();
            } else if (e.key === "Enter" || e.key === "Tab") {
                if (selectedIndex >= 0 && selectedIndex < matchingOptions.length) {
                    e.preventDefault();
                    selectOption(matchingOptions[selectedIndex]);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeDropdown();
            }
        });

        textarea.addEventListener("blur", () => {
            // Delay để kịp click chuột vào option
            setTimeout(() => {
                closeDropdown();
            }, 200);
        });

        function scrollOptionIntoView() {
            const activeEl = dropdown.querySelector(".mention-option.is-active");
            if (activeEl) {
                activeEl.scrollIntoView({ block: "nearest" });
            }
        }
    }

    /**
     * Thu thập danh sách mentions thực tế xuất hiện trong văn bản
     */
    function extractValidMentions(content) {
        const mentions = [];
        if (!content) return mentions;

        // Kiểm tra @all
        if (/@all\b/i.test(content)) {
            mentions.push({ type: "all" });
        }

        // Kiểm tra các vai trò hệ thống
        SYSTEM_ROLES.forEach(r => {
            if (r.role !== "all") {
                const regex = new RegExp(`@${r.role}\\b`, "i");
                if (regex.test(content)) {
                    mentions.push({ type: "role", role: r.role });
                }
            }
        });

        // Kiểm tra các thành viên workspace đã chọn qua autocomplete hoặc gõ tên
        workspaceMembers.forEach(m => {
            if (content.includes(`@${m.name}`)) {
                mentions.push({
                    type: "user",
                    id: m.user_id,
                    name: m.name,
                    role: m.role
                });
            }
        });

        // Thêm bất kỳ mention nào từ activeMentionsList mà vẫn còn xuất hiện trong text
        activeMentionsList.forEach(m => {
            if (m.type === "all" && !mentions.some(x => x.type === "all")) {
                mentions.push(m);
            } else if (m.type === "role" && !mentions.some(x => x.type === "role" && x.role === m.role)) {
                mentions.push(m);
            } else if (m.type === "user" && !mentions.some(x => x.type === "user" && x.id === m.id)) {
                if (content.includes(`@${m.name}`)) {
                    mentions.push(m);
                }
            }
        });

        return mentions;
    }

    /**
     * Gắn các sự kiện click, gửi, sửa, xoá bình luận
     */
    function bindCommentEvents(client, currentUser) {
        if (!currentContainer) return;

        // 1. Gửi bình luận gốc (Main Composer)
        const sendMainBtn = currentContainer.querySelector("#sendMainCommentBtn");
        const mainInput = currentContainer.querySelector("#mainCommentTextarea");

        async function submitMainComment() {
            const content = (mainInput?.value || "").trim();
            if (!content) return;

            if (sendMainBtn) sendMainBtn.disabled = true;

            try {
                const mentionsPayload = extractValidMentions(content);
                const { data, error } = await client.rpc("aecpt_create_comment", {
                    p_task_id: currentTaskId,
                    p_parent_id: null,
                    p_content: content,
                    p_mentions: mentionsPayload
                });

                if (error) throw error;

                // Nếu có email cần gửi qua Brevo (Rule 2A)
                if (data?.emails_to_send && data.emails_to_send.length > 0) {
                    client.functions.invoke("send-comment-notification", {
                        body: {
                            recipients: data.emails_to_send
                        }
                    }).then(res => {
                        console.log("Đã gửi email thông báo mention qua Brevo:", res.data);
                    }).catch(err => {
                        console.warn("Lỗi gửi email mention:", err);
                    });
                }

                // Xóa input và reload
                if (mainInput) mainInput.value = "";
                activeMentionsList = [];
                await reloadAndRenderComments();
            } catch (err) {
                console.error("Không thể đăng bình luận:", err);
                alert("Không thể đăng bình luận: " + (err.message || err));
            } finally {
                if (sendMainBtn) sendMainBtn.disabled = false;
            }
        }

        sendMainBtn?.addEventListener("click", submitMainComment);
        mainInput?.addEventListener("keydown", (e) => {
            // Nhấn Ctrl+Enter hoặc Cmd+Enter để gửi nhanh
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitMainComment();
            }
        });

        // 2. Click nút Phản hồi
        currentContainer.querySelectorAll("[data-reply-btn]").forEach(btn => {
            btn.addEventListener("click", () => {
                const commentId = btn.dataset.replyBtn;
                const targetComment = commentsData.find(c => c.comment_id === commentId);
                if (targetComment) {
                    replyingToComment = targetComment;
                    editingCommentId = null;
                    renderCommentsUI();
                }
            });
        });

        // 3. Click nút Hủy phản hồi
        currentContainer.querySelector("[data-cancel-reply]")?.addEventListener("click", () => {
            replyingToComment = null;
            activeMentionsList = [];
            renderCommentsUI();
        });

        // 4. Gửi phản hồi (Reply Composer)
        currentContainer.querySelectorAll("[data-send-reply]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const commentId = btn.dataset.sendReply;
                const replyInput = currentContainer.querySelector(`#replyTextarea_${commentId}`);
                const content = (replyInput?.value || "").trim();
                if (!content) return;

                btn.disabled = true;
                try {
                    const mentionsPayload = extractValidMentions(content);
                    const { data, error } = await client.rpc("aecpt_create_comment", {
                        p_task_id: currentTaskId,
                        p_parent_id: commentId,
                        p_content: content,
                        p_mentions: mentionsPayload
                    });

                    if (error) throw error;

                    // Nếu có email cần gửi qua Brevo
                    if (data?.emails_to_send && data.emails_to_send.length > 0) {
                        client.functions.invoke("send-comment-notification", {
                            body: {
                                recipients: data.emails_to_send
                            }
                        }).then(res => {
                            console.log("Đã gửi email phản hồi mention qua Brevo:", res.data);
                        }).catch(err => {
                            console.warn("Lỗi gửi email mention:", err);
                        });
                    }

                    replyingToComment = null;
                    activeMentionsList = [];
                    await reloadAndRenderComments();
                } catch (err) {
                    console.error("Không thể gửi phản hồi:", err);
                    alert("Không thể gửi phản hồi: " + (err.message || err));
                } finally {
                    btn.disabled = false;
                }
            });
        });

        // 5. Click nút Sửa bình luận
        currentContainer.querySelectorAll("[data-edit-btn]").forEach(btn => {
            btn.addEventListener("click", () => {
                editingCommentId = btn.dataset.editBtn;
                replyingToComment = null;
                renderCommentsUI();
            });
        });

        // 6. Click nút Hủy sửa
        currentContainer.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
            editingCommentId = null;
            renderCommentsUI();
        });

        // 7. Click nút Lưu chỉnh sửa
        currentContainer.querySelectorAll("[data-save-edit]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const commentId = btn.dataset.saveEdit;
                const editInput = currentContainer.querySelector(`#editCommentInput_${commentId}`);
                const newContent = (editInput?.value || "").trim();
                if (!newContent) {
                    alert("Nội dung bình luận không được để trống.");
                    return;
                }

                btn.disabled = true;
                try {
                    const { error } = await client.rpc("aecpt_update_comment", {
                        p_comment_id: commentId,
                        p_content: newContent
                    });
                    if (error) throw error;

                    editingCommentId = null;
                    await reloadAndRenderComments();
                } catch (err) {
                    console.error("Lỗi cập nhật bình luận:", err);
                    alert("Không thể cập nhật bình luận: " + (err.message || err));
                } finally {
                    btn.disabled = false;
                }
            });
        });

        // 8. Click nút Xoá bình luận
        currentContainer.querySelectorAll("[data-delete-btn]").forEach(btn => {
            btn.addEventListener("click", async () => {
                const commentId = btn.dataset.deleteBtn;
                if (!confirm("Bạn có chắc chắn muốn xoá bình luận này?")) return;

                try {
                    const { error } = await client.rpc("aecpt_delete_comment", {
                        p_comment_id: commentId
                    });
                    if (error) throw error;

                    await reloadAndRenderComments();
                } catch (err) {
                    console.error("Lỗi xoá bình luận:", err);
                    alert("Không thể xoá bình luận: " + (err.message || err));
                }
            });
        });
    }

    /**
     * Tải lại dữ liệu bình luận từ database và render lại
     */
    async function reloadAndRenderComments() {
        if (!currentTaskId || !currentContainer) return;
        const client = window.supabaseClient;
        commentsData = await fetchTaskComments(client, currentTaskId);
        await renderCommentsUI();
    }

    /**
     * Khởi tạo kênh Supabase Realtime cho task hiện tại
     */
    function subscribeRealtime(client, taskId) {
        if (activeChannel) {
            try {
                client.removeChannel(activeChannel);
            } catch (e) {
                console.warn("Lỗi hủy kênh Realtime cũ:", e);
            }
            activeChannel = null;
        }

        try {
            activeChannel = client.channel(`task_comments_${taskId}`)
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "task_comments",
                        filter: `task_id=eq.${taskId}`
                    },
                    async (payload) => {
                        console.log("Realtime comment update:", payload);
                        await reloadAndRenderComments();
                    }
                )
                .subscribe((status) => {
                    if (status === "SUBSCRIBED") {
                        console.log(`Đã kích hoạt Realtime bình luận cho task ${taskId}`);
                    }
                });
        } catch (error) {
            console.warn("Không thể đăng ký Supabase Realtime cho bình luận:", error);
        }
    }

    /**
     * API công khai của module TaskComments
     */
    window.TaskComments = {
        /**
         * Gắn giao diện bình luận vào container
         * @param {HTMLElement} container 
         * @param {string} taskId 
         * @param {Object} taskInfo { title, workspaceId, ... }
         */
        async mount(container, taskId, taskInfo = {}) {
            if (!container || !taskId) return;

            const client = window.supabaseClient;
            if (!client) {
                console.error("TaskComments: Chưa tìm thấy window.supabaseClient");
                return;
            }

            currentTaskId = taskId;
            currentContainer = container;
            currentTaskInfo = taskInfo;
            replyingToComment = null;
            editingCommentId = null;
            activeMentionsList = [];

            // Hiển thị trạng thái đang tải
            container.innerHTML = `
                <div class="task-comments-wrapper">
                    <div style="padding: 16px; text-align: center; color: #64748b; font-size: 13.5px;">
                        <i data-lucide="loader" class="spin" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:6px;"></i>
                        Đang tải bình luận...
                    </div>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();

            // Lấy workspaceId từ taskInfo hoặc appUser
            const workspaceId = taskInfo.workspaceId || window.appUser?.workspaceId || "WS_01";

            // Tải song song thành viên và bình luận
            const [members, comments] = await Promise.all([
                loadWorkspaceMembers(client, workspaceId),
                fetchTaskComments(client, taskId)
            ]);

            workspaceMembers = members;
            commentsData = comments;

            // Render giao diện
            await renderCommentsUI();

            // Đăng ký realtime lắng nghe thay đổi
            subscribeRealtime(client, taskId);
        },

        /**
         * Hủy đăng ký realtime khi popup/modal đóng
         */
        unmount() {
            if (activeChannel && window.supabaseClient) {
                try {
                    window.supabaseClient.removeChannel(activeChannel);
                } catch (e) {
                    // Ignore cleanup error
                }
                activeChannel = null;
            }
            currentTaskId = null;
            currentContainer = null;
            replyingToComment = null;
            editingCommentId = null;
        }
    };
})();
