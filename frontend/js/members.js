
/* =====================================================
   MULTIMEDIA TASK - MEMBERS PAGE
   Member Management
   API-ready: Không sử dụng dữ liệu test
===================================================== */


/* =====================================================
   1. API CONFIGURATION
===================================================== */

// Dữ liệu lấy từ API, không khởi tạo dữ liệu mẫu.
let members = [];

let currentFilter = "all";
let currentMemberId = null;
let currentAccountMemberId = null;
let currentAccountIsTeamLeader = false;
let currentWorkspace = null;
let currentUserCanManageWorkspace = false;
let workspaceMemberRemovalReady = false;
let currentWorkspaceMemberIds = new Set();
let currentUser = null;
let searchKeyword = "";
let isLoading = false;
let availabilityByDay = {};


/* =====================================================
   2. DOM ELEMENTS
===================================================== */

const DOM = {
    search: document.getElementById("memberSearch"),

    tableBody: document.getElementById("memberTableBody"),

    emptyState: document.getElementById("memberEmptyState"),

    totalCount: document.getElementById("totalMemberCount"),

    filteredCount: document.getElementById("filteredMemberCount"),

    tableTitle: document.getElementById("tableTitle"),

    footerInfo: document.getElementById("tableFooterInfo"),

    filters: document.querySelectorAll(".filter-btn"),

    clearFilter: document.getElementById("clearFilter"),

    openAddButton: document.getElementById("openAddMember"),

    addModal: document.getElementById("addMemberModal"),

    updateModal: document.getElementById("updateMemberModal"),

    addForm: document.getElementById("addMemberForm"),

    outgoingInvitations: document.getElementById("outgoingWorkspaceInvitations"),

    incomingInvitations: document.getElementById("incomingWorkspaceInvitations"),

    invitationFeedback: document.getElementById("workspaceInvitationFeedback"),

    updateForm: document.getElementById("updateMemberForm"),

    detailPanel: document.getElementById("memberDetailPanel"),

    detailContent: document.getElementById("memberDetailContent"),

    closeDetail: document.getElementById("closeDetailPanel")
};

if (DOM.openAddButton) {
    DOM.openAddButton.hidden = true;
}


/* =====================================================
   4. LOAD MEMBERS FROM DATABASE
===================================================== */

const MEMBER_PROFILE_FIELDS = `
    member_id,
    workspace_id,
    member_label,
    email,
    is_active,
    n_roles_in_roster,
    n_tasks_assigned,
    member_roles (
        role,
        in_roster,
        n_tasks_assigned
    )
`;

async function loadMemberProfiles() {
    const client = window.supabaseClient;
    const result = await client
        .from("members")
        .select(`removed_from_workspace_at, ${MEMBER_PROFILE_FIELDS}`);

    if (!result.error) {
        workspaceMemberRemovalReady = true;
        return result;
    }

    const errorText = `${result.error.message || ""} ${result.error.details || ""}`;
    if (!errorText.includes("removed_from_workspace_at")) {
        throw result.error;
    }

    workspaceMemberRemovalReady = false;
    return client
        .from("members")
        .select(MEMBER_PROFILE_FIELDS);
}

async function loadMembers() {
    showLoading();

    try {
        const { data: sessionData, error: sessionError } =
            await window.supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        const user = sessionData.session?.user || null;
        currentUser = user;

        const [membersResult, availabilityResult, accountRolesResult] = await Promise.all([
            loadMemberProfiles(),
            window.supabaseClient
                .from("member_availability")
                .select("availability_id, member_id, weekday, start_time, end_time")
                .order("weekday")
                .order("start_time"),
            window.supabaseClient
                .from("team_members")
                .select("user_id, member_id, account_role")
        ]);

        if (membersResult.error) throw membersResult.error;
        if (availabilityResult.error) throw availabilityResult.error;
        if (accountRolesResult.error) throw accountRolesResult.error;

        const ownMembership = (accountRolesResult.data || []).find(row =>
            user && String(row.user_id) === String(user.id)
        );
        currentAccountMemberId = ownMembership?.member_id ||
            user?.user_metadata?.member_id ||
            user?.app_metadata?.member_id ||
            null;
        currentAccountIsTeamLeader = isTeamLeaderRole(
            ownMembership?.account_role || user?.app_metadata?.role
        );

        const availabilityByMember = new Map();
        (availabilityResult.data || []).forEach(row => {
            const memberAvailability = availabilityByMember.get(String(row.member_id)) || [];
            memberAvailability.push(row);
            availabilityByMember.set(String(row.member_id), memberAvailability);
        });
        const accountRoleByMember = new Map(
            (accountRolesResult.data || []).map(row => [
                String(row.member_id),
                formatAccountRole(row.account_role)
            ])
        );

        members = (membersResult.data || []).map(member => {
            const roles = Array.isArray(member.member_roles)
                ? member.member_roles
                : [];
            const groups = [...new Set(roles
                .map(memberRole => normalizeMemberGroup(memberRole.role))
                .filter(Boolean))];

            return {
                id: member.member_id,
                workspaceId: member.workspace_id || null,
                removedFromWorkspace: Boolean(member.removed_from_workspace_at),
                name: member.member_label || "",
                email: member.email || "",
                groups,
                group: groups.join(", "),
                role: accountRoleByMember.get(String(member.member_id)) || "Thành viên",
                status: member.is_active
                    ? "active"
                    : "inactive",
                assignedTasks: Number(member.n_tasks_assigned) || 0,
                member_roles: roles,
                availability: availabilityByMember.get(String(member.member_id)) || []
            };
        });

        await loadWorkspaceInvitations(user);
        members = members.filter(member => {
            if (member.removedFromWorkspace) return false;
            const belongsToWorkspace = currentWorkspace?.workspace_id &&
                String(member.workspaceId) === String(currentWorkspace.workspace_id);
            const hasLegacyWorkspaceLink = currentWorkspaceMemberIds.has(String(member.id));
            const isCurrentMember = currentAccountMemberId &&
                String(currentAccountMemberId) === String(member.id);
            return belongsToWorkspace || hasLegacyWorkspaceLink || isCurrentMember;
        });
        renderMembers();
        updateMemberCounts();
    } catch (error) {
        console.error("Không thể tải danh sách thành viên:", error);
        showError("Không thể tải danh sách thành viên.");
    }
}

function invitationStatusLabel(status) {
    return {
        pending: "Đang chờ",
        accepted: "Đã chấp nhận",
        cancelled: "Đã hủy",
        declined: "Đã từ chối"
    }[status] || status;
}

function renderWorkspaceInvitations(container, invitations, direction) {
    if (!container) return;
    container.replaceChildren();

    if (!invitations.length) {
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "workspace-invitations-empty";
        emptyMessage.textContent = "Chưa có lời mời.";
        container.appendChild(emptyMessage);
        return;
    }

    invitations.forEach(invitation => {
        const item = document.createElement("article");
        item.className = "workspace-invitation-item";

        const details = document.createElement("div");
        details.className = "workspace-invitation-details";

        const email = document.createElement("strong");
        email.textContent = invitation.email;
        details.appendChild(email);

        const status = document.createElement("span");
        status.className = `workspace-invitation-status is-${invitation.status}`;
        status.textContent = invitationStatusLabel(invitation.status);
        details.appendChild(status);

        const actions = document.createElement("div");
        actions.className = "workspace-invitation-actions";
        if (invitation.status === "pending") {
            const actionNames = direction === "incoming"
                ? [["accept", "Chấp nhận"], ["decline", "Từ chối"]]
                : [["cancel", "Hủy lời mời"]];
            actionNames.forEach(([action, label]) => {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.invitationAction = action;
                button.dataset.invitationId = invitation.invitation_id;
                button.textContent = label;
                actions.appendChild(button);
            });
        }

        item.append(details, actions);
        container.appendChild(item);
    });
}

async function loadWorkspaceInvitations(user) {
    const showLoadError = message => {
        [DOM.outgoingInvitations, DOM.incomingInvitations].forEach(container => {
            if (!container) return;
            container.replaceChildren();
            const errorMessage = document.createElement("p");
            errorMessage.className = "workspace-invitations-error";
            errorMessage.textContent = message;
            container.appendChild(errorMessage);
        });
    };

    if (!user?.id) {
        currentWorkspace = null;
        if (DOM.openAddButton) DOM.openAddButton.hidden = true;
        currentWorkspaceMemberIds = new Set();
        showLoadError("Cần đăng nhập để tải lời mời workspace.");
        return;
    }

    try {
        if (typeof window.ensurePersonalWorkspace !== "function") {
            throw new Error("Chưa khởi tạo chức năng tải workspace cá nhân.");
        }

        currentWorkspace = await window.ensurePersonalWorkspace(user);
        const isWorkspaceOwner = String(currentWorkspace.created_by) === String(user.id);

        const client = window.supabaseClient;
        const outgoingRequest = isWorkspaceOwner || currentAccountIsTeamLeader
            ? client
                .from("workspace_invitations")
                .select("invitation_id, email, member_id, status, created_at")
                .eq("workspace_id", currentWorkspace.workspace_id)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null });
        const incomingRequest = user.email
            ? client
                .from("workspace_invitations")
                .select("invitation_id, workspace_id, email, member_id, status, created_at")
                .ilike("email", user.email)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null });
        const workspaceMembersRequest = client
            .from("team_members")
            .select("member_id")
            .eq("workspace_id", currentWorkspace.workspace_id);

        const [outgoingResult, incomingResult, workspaceMembersResult] = await Promise.all([
            outgoingRequest,
            incomingRequest,
            workspaceMembersRequest
        ]);
        if (outgoingResult.error) throw outgoingResult.error;
        if (incomingResult.error) throw incomingResult.error;
        if (workspaceMembersResult.error) throw workspaceMembersResult.error;

        const hasAcceptedWorkspaceInvitation = (incomingResult.data || []).some(invitation =>
            invitation.status === "accepted" &&
            String(invitation.workspace_id) === String(currentWorkspace.workspace_id)
        );
        currentUserCanManageWorkspace = currentAccountIsTeamLeader &&
            (isWorkspaceOwner || hasAcceptedWorkspaceInvitation);
        const workspaceMemberIds = (workspaceMembersResult.data || [])
            .map(membership => String(membership.member_id));
        const acceptedInvitationMemberIds = [
            ...(outgoingResult.data || []),
            ...(incomingResult.data || [])
        ]
            .filter(invitation =>
                invitation.status === "accepted" &&
                String(invitation.workspace_id || currentWorkspace.workspace_id) ===
                    String(currentWorkspace.workspace_id) &&
                invitation.member_id
            )
            .map(invitation => String(invitation.member_id));
        currentWorkspaceMemberIds = new Set([
            ...workspaceMemberIds,
            ...acceptedInvitationMemberIds
        ]);
        if (DOM.openAddButton) {
            DOM.openAddButton.hidden = !currentUserCanManageWorkspace;
        }

        renderWorkspaceInvitations(
            DOM.outgoingInvitations,
            outgoingResult.data || [],
            "outgoing"
        );
        renderWorkspaceInvitations(
            DOM.incomingInvitations,
            incomingResult.data || [],
            "incoming"
        );
    } catch (error) {
        console.error("Không thể tải lời mời workspace:", error);
        currentWorkspace = null;
        currentUserCanManageWorkspace = false;
        currentWorkspaceMemberIds = new Set();
        if (DOM.openAddButton) DOM.openAddButton.hidden = true;
        showLoadError("Không thể tải lời mời. Vui lòng kiểm tra quyền truy cập Supabase.");
    }
}


/* =====================================================
   5. FILTER MEMBERS
===================================================== */

function getFilteredMembers() {

    return members.filter(member => {

        const keyword = searchKeyword.toLowerCase();

        const name = (member.name || "").toLowerCase();

        const email = (member.email || "").toLowerCase();

        const groups = getMemberGroups(member);

        const matchesSearch =
            name.includes(keyword) ||
            email.includes(keyword);

        const matchesGroup =
            currentFilter === "all" ||
            groups.some(group =>
                normalizeMemberGroup(group) === normalizeMemberGroup(currentFilter)
            );

        return matchesSearch && matchesGroup;

    }).sort((memberA, memberB) => {
        const memberAIsCurrent = currentAccountMemberId != null &&
            String(memberA.id) === String(currentAccountMemberId);
        const memberBIsCurrent = currentAccountMemberId != null &&
            String(memberB.id) === String(currentAccountMemberId);
        return Number(memberBIsCurrent) - Number(memberAIsCurrent);
    });

}


function getMemberGroups(member) {
    const roles = Array.isArray(member.member_roles)
        ? member.member_roles.map(memberRole => memberRole.role)
        : [];
    const legacyGroups = [member.group, member.department]
        .flatMap(value => Array.isArray(value)
            ? value
            : String(value || "").split(","));
    const groups = [
        ...(Array.isArray(member.groups) ? member.groups : []),
        ...roles,
        ...legacyGroups
    ]
        .filter(Boolean)
        .map(normalizeMemberGroup)
        .filter(Boolean);

    return [...new Set(groups)];
}

function normalizeMemberGroup(value) {
    const normalized = String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");

    const groupLabels = {
        edit: "Edit",
        editor: "Edit",
        video_editor: "Edit",
        design: "Design",
        designer: "Design",
        content: "Content",
        content_writer: "Content",
        content_creator: "Content",
        tech: "Tech",
        technician: "Tech",
        technical: "Tech",
        photo: "Photo",
        photographer: "Photo",
        photography: "Photo"
    };

    return groupLabels[normalized] || String(value || "").trim();
}

function formatAccountRole(value) {
    const role = String(value || "").trim().toLowerCase();
    if (isTeamLeaderRole(role)) return "Trưởng nhóm";
    if (role === "member" || role === "thành viên") return "Thành viên";
    return value ? String(value).trim() : "Thành viên";
}

function isTeamLeaderRole(value) {
    return ["leader", "team_leader", "trưởng nhóm"]
        .includes(String(value || "").trim().toLocaleLowerCase("vi"));
}

function canUpdateMember(memberId) {
    return currentAccountIsTeamLeader ||
        (currentAccountMemberId != null &&
            String(currentAccountMemberId) === String(memberId));
}


/* =====================================================
   6. RENDER MEMBER TABLE
===================================================== */

function renderMembers() {

    if (!DOM.tableBody) return;

    const filteredMembers = getFilteredMembers();

    DOM.tableBody.innerHTML = "";

    if (filteredMembers.length === 0) {

        DOM.emptyState.hidden = false;

        DOM.tableBody.innerHTML = "";

        updateTableInfo(0);

        return;

    }

    DOM.emptyState.hidden = true;

    filteredMembers.forEach(member => {

        const row = document.createElement("tr");

        const group = getMemberGroups(member).join(", ");

        const role = member.role || "Thành viên";

        const status = member.status || "active";

        const isActive =
            status === "active" ||
            status === "Đang hoạt động";

        row.dataset.memberId = member.id;
        if (currentAccountMemberId != null &&
            String(member.id) === String(currentAccountMemberId)) {
            row.classList.add("current-user-member");
        }

        row.innerHTML = `

            <td>
                <div class="member-name-cell">

                    <div class="member-avatar">
                        ${escapeHTML(getInitials(member.name))}
                    </div>

                    <span>
                        ${escapeHTML(member.name || "Chưa có tên")}
                    </span>

                </div>
            </td>

            <td>
                <span class="group-badge">
                    ${escapeHTML(group || "Chưa phân nhóm")}
                </span>
            </td>

            <td>
                <span class="member-role">
                    ${escapeHTML(role)}
                </span>
            </td>

            <td class="member-email">
                ${escapeHTML(member.email || "Chưa cập nhật")}
            </td>

            <td>
                <span class="member-status ${isActive ? "" : "inactive"}">
                    ${isActive ? "Đang hoạt động" : "Không hoạt động"}
                </span>
            </td>

            <td>
                <button
                    type="button"
                    class="member-action-btn"
                    data-action="detail"
                    data-id="${escapeHTML(member.id)}"
                    title="Xem chi tiết"
                >
                    <i data-lucide="ellipsis"></i>
                </button>
            </td>

        `;

        DOM.tableBody.appendChild(row);

    });

    updateTableInfo(filteredMembers.length);

    refreshIcons();

}


/* =====================================================
   7. UPDATE MEMBER COUNTS
===================================================== */

function updateMemberCounts() {

    if (DOM.totalCount) {
        DOM.totalCount.textContent = members.length;
    }

    document.querySelectorAll("[data-count]").forEach(element => {

        const group = element.dataset.count;

        const count = members.filter(member => {

            return getMemberGroups(member).some(memberGroup =>
                normalizeMemberGroup(memberGroup) === normalizeMemberGroup(group)
            );

        }).length;

        element.textContent = count;

    });

}


function updateTableInfo(count) {

    if (DOM.filteredCount) {
        DOM.filteredCount.textContent =
            `${count} thành viên`;
    }

    if (DOM.footerInfo) {

        DOM.footerInfo.textContent =
            `Hiển thị ${count} trong ${members.length} thành viên`;

    }

    if (DOM.clearFilter) {

        DOM.clearFilter.hidden =
            currentFilter === "all" && searchKeyword === "";

    }

}


/* =====================================================
   8. SEARCH MEMBERS
===================================================== */

if (DOM.search) {

    DOM.search.addEventListener("input", event => {

        searchKeyword = event.target.value.trim();

        renderMembers();

    });

}


/* =====================================================
   9. FILTER BY GROUP
===================================================== */

DOM.filters.forEach(button => {

    button.addEventListener("click", () => {
        setMemberFilter(button.dataset.group);
    });

});

function setMemberFilter(group) {
    if (!group) return;

    currentFilter = group;

    DOM.filters.forEach(button => {
        button.classList.toggle("active", button.dataset.group === group);
    });
    updateTableTitle();
    renderMembers();
}


function updateTableTitle() {

    if (!DOM.tableTitle) return;

    DOM.tableTitle.textContent =
        currentFilter === "all"
            ? "Danh sách thành viên"
            : `Thành viên nhóm ${currentFilter}`;

}


/* CLEAR FILTER */

if (DOM.clearFilter) {

    DOM.clearFilter.addEventListener("click", () => {

        currentFilter = "all";

        searchKeyword = "";

        if (DOM.search) {
            DOM.search.value = "";
        }

        DOM.filters.forEach(button => {

            button.classList.toggle(
                "active",
                button.dataset.group === "all"
            );

        });

        updateTableTitle();

        renderMembers();

    });

}


/* =====================================================
   10. VIEW MEMBER DETAIL
===================================================== */

async function openMemberDetail(memberId) {

    try {

        const member = members.find(
            item => String(item.id) === String(memberId)
        );

        if (!member) return;

        currentMemberId = memberId;

        renderMemberDetail(member);

        DOM.detailPanel.hidden = false;

        refreshIcons();

    } catch (error) {

        console.error("Không thể tải chi tiết thành viên:", error);

    }

}


/* RENDER DETAIL */

function renderMemberDetail(member) {
    if (!DOM.detailContent) return;

    const tasks = Array.isArray(member.tasks)
        ? member.tasks
        : [];

    const assignedTasks =
        member.assignedTasks ?? tasks.length;

    const completedTasks =
        member.completedTasks ??
        tasks.filter(task => task.status === "completed").length;

    const activeTasks = tasks.filter(task =>
        task.status !== "completed"
    );
    const availability = renderAvailabilitySummary(member.availability || []);
    const canEditMember = canUpdateMember(member.id);
    const canRemoveMember = workspaceMemberRemovalReady &&
        currentUserCanManageWorkspace &&
        !isTeamLeaderRole(member.role) &&
        String(member.id) !== String(currentAccountMemberId);

    DOM.detailContent.innerHTML = `

        <div class="detail-profile">

            <div class="detail-avatar">
                ${escapeHTML(getInitials(member.name))}
            </div>

            <div class="detail-profile-info">

                <h2>${escapeHTML(member.name || "")}</h2>

                <p>${escapeHTML(member.email || "")}</p>

            </div>

        </div>


        <div class="detail-section">

            <h4>Thông tin thành viên</h4>

            <div class="detail-info-row">
                <span>Nhóm chức năng</span>
                <strong>
                    ${escapeHTML(getMemberGroups(member).join(", ") || "Chưa cập nhật")}
                </strong>
            </div>

            <div class="detail-info-row">
                <span>Vai trò</span>
                <strong>
                    ${escapeHTML(member.role || "Thành viên")}
                </strong>
            </div>

            <div class="detail-info-row">
                <span>Trạng thái tài khoản</span>
                <strong>
                    ${member.status === "inactive"
                        ? "Không hoạt động"
                        : "Đang hoạt động"}
                </strong>
            </div>

        </div>


        <div class="detail-divider"></div>


        <div class="detail-stats">

            <div class="detail-stat-card">

                <span>Công việc được giao</span>

                <strong>${Number(assignedTasks) || 0}</strong>

            </div>

            <div class="detail-stat-card">

                <span>Công việc đã hoàn thành</span>

                <strong>${Number(completedTasks) || 0}</strong>

            </div>

        </div>


        <div class="detail-section">

            <h4>
                Công việc đang thực hiện
                (${activeTasks.length})
            </h4>

            <div class="detail-task-list">

                ${activeTasks.length
                    ? activeTasks.map(task => `

                        <div class="detail-task-item">

                            <div class="detail-task-icon">
                                <i data-lucide="file-text"></i>
                            </div>

                            <div class="detail-task-info">

                                <strong>
                                    ${escapeHTML(task.title || task.name || "")}
                                </strong>

                                <span>
                                    ${task.deadline
                                        ? `Hạn ${escapeHTML(task.deadline)}`
                                        : "Chưa có deadline"}
                                </span>

                            </div>

                        </div>

                    `).join("")
                    : `
                        <p class="field-description">
                            Không có công việc đang thực hiện.
                        </p>
                    `
                }

            </div>

        </div>

        <div class="detail-section">
            <h4>Thời gian rảnh</h4>
            ${availability}
        </div>


        ${canEditMember || canRemoveMember ? `
            <div class="detail-member-actions">
            ${canEditMember ? `
                <button
                    type="button"
                    class="save-btn"
                    id="openUpdateMember"
                    data-id="${escapeHTML(member.id)}"
                >
                    Cập nhật thông tin
                </button>
            ` : ""}
            ${canRemoveMember ? `
                <button
                    type="button"
                    class="delete-member-btn"
                    id="removeMemberFromWorkspace"
                    data-id="${escapeHTML(member.id)}"
                >
                    Xóa thành viên
                </button>
            ` : ""}
            </div>
        ` : ""}

    `;

    refreshIcons();

}


/* CLOSE DETAIL */

if (DOM.closeDetail) {

    DOM.closeDetail.addEventListener("click", () => {

        DOM.detailPanel.hidden = true;

        currentMemberId = null;

    });

}


/* =====================================================
   11. ADD MEMBER MODAL
===================================================== */

function openAddMemberModal() {
    if (
        !currentUser?.id ||
        !currentWorkspace ||
        !currentUserCanManageWorkspace ||
        !DOM.addModal
    ) return;

    setInvitationFeedback("");
    DOM.addModal.hidden = false;
    refreshIcons();
}


function closeAddMemberModal() {

    if (!DOM.addModal) return;

    DOM.addModal.hidden = true;
}

const toggleInitialPasswordButton = document.getElementById("toggleMemberInitialPassword");
toggleInitialPasswordButton?.addEventListener("click", () => {
    const passwordInput = DOM.addForm?.elements.initialPassword;
    if (!passwordInput) return;

    const showPassword = passwordInput.type === "password";
    passwordInput.type = showPassword ? "text" : "password";
    toggleInitialPasswordButton.textContent = showPassword ? "Ẩn" : "Hiện";
    toggleInitialPasswordButton.setAttribute(
        "aria-label",
        showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
    );
});

if (DOM.openAddButton) {

    DOM.openAddButton.addEventListener(
        "click",
        openAddMemberModal
    );

}

function setInvitationFeedback(message, kind = "") {
    if (!DOM.invitationFeedback) return;
    DOM.invitationFeedback.textContent = message;
    DOM.invitationFeedback.classList.toggle("is-error", kind === "error");
    DOM.invitationFeedback.classList.toggle("is-success", kind === "success");
}

async function handleWorkspaceInvitationAction(event) {
    const button = event.target.closest("[data-invitation-action]");
    if (!button || button.disabled) return;

    const invitationId = button.dataset.invitationId;
    const action = button.dataset.invitationAction;
    const statusByAction = {
        accept: "accepted",
        decline: "declined",
        cancel: "cancelled"
    };
    const nextStatus = statusByAction[action];
    if (!invitationId || !nextStatus || !currentUser?.id) return;

    button.disabled = true;
    try {
        const client = window.supabaseClient;
        const updateValues = {
            status: nextStatus,
            responded_at: new Date().toISOString()
        };

        if (action === "accept") {
            const invitation = await client
                .from("workspace_invitations")
                .select("email")
                .eq("invitation_id", invitationId)
                .eq("status", "pending")
                .maybeSingle();
            if (invitation.error) throw invitation.error;
            if (!invitation.data) {
                throw new Error("Lời mời không còn ở trạng thái chờ phản hồi.");
            }

            const matchingMember = await client
                .from("members")
                .select("member_id")
                .ilike("email", invitation.data.email)
                .limit(1)
                .maybeSingle();
            if (matchingMember.error) throw matchingMember.error;
            updateValues.member_id = matchingMember.data?.member_id || null;
        }

        const { data, error } = await client
            .from("workspace_invitations")
            .update(updateValues)
            .eq("invitation_id", invitationId)
            .eq("status", "pending")
            .select("invitation_id")
            .maybeSingle();
        if (error) throw error;
        if (!data) {
            throw new Error("Lời mời đã được xử lý hoặc bạn không có quyền cập nhật.");
        }

        await loadMembers();
    } catch (error) {
        console.error("Không thể cập nhật lời mời workspace:", error);
        window.alert("Không thể cập nhật lời mời. Vui lòng kiểm tra quyền truy cập Supabase.");
        button.disabled = false;
    }
}

DOM.outgoingInvitations?.addEventListener("click", handleWorkspaceInvitationAction);
DOM.incomingInvitations?.addEventListener("click", handleWorkspaceInvitationAction);


/* =====================================================
   12. UPDATE MEMBER MODAL
===================================================== */

function openUpdateMemberModal(memberId) {

    const member = members.find(
        item => String(item.id) === String(memberId)
    );

    if (!member || !canUpdateMember(member.id) || !DOM.updateModal) return;

    currentMemberId = memberId;

    DOM.updateModal.hidden = false;

    // Xóa lựa chọn cũ trước khi điền nhóm chức năng của thành viên hiện tại.
    DOM.updateForm.reset();

    // Điền thông tin vào form dựa trên name của input.
    fillForm(DOM.updateForm, member);
    initializeAvailability(member.availability || {});
    showAvailabilityMessage("");

    refreshIcons();

}


function closeUpdateMemberModal() {

    if (!DOM.updateModal) return;

    DOM.updateModal.hidden = true;

}


// Hiển thị các nhóm đã chọn dưới dạng thẻ trong ô chọn.
function updateSelectedGroupsUI() {
    const selectedContainer = document.getElementById("selectedGroups");
    const optionsContainer = document.getElementById("groupOptions");

    if (!selectedContainer || !optionsContainer) return;

    const selectedValues = Array.from(
        optionsContainer.querySelectorAll('input[name="groups"]:checked')
    ).map(input => input.value);

    selectedContainer.innerHTML = `
        <span class="selected-group-tags">
            ${selectedValues.length
                ? selectedValues.map(group => `
                    <span class="selected-skill-tag">
                        ${escapeHTML(group)}
                        <span aria-hidden="true">×</span>
                    </span>
                `).join("")
                : '<span class="skill-placeholder">Chọn nhóm chức năng</span>'
            }
        </span>
        <span class="dropdown-arrow">⌄</span>
    `;
    selectedContainer.setAttribute("aria-expanded", String(!optionsContainer.hidden));
}

const AVAILABILITY_DAY_NAMES = {
    "2": "Thứ 2", "3": "Thứ 3", "4": "Thứ 4", "5": "Thứ 5",
    "6": "Thứ 6", "7": "Thứ 7", "8": "Chủ nhật"
};

const UI_DAY_TO_DB_WEEKDAY = {
    "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 0
};

const DB_WEEKDAY_TO_UI_DAY = {
    0: "8", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6", 6: "7"
};

const AVAILABILITY_START_LIMIT = "06:00";
const AVAILABILITY_END_LIMIT = "22:00";

function initializeAvailability(value = {}) {
    availabilityByDay = {};

    if (Array.isArray(value)) {
        value.forEach(row => {
            const day = DB_WEEKDAY_TO_UI_DAY[Number(row.weekday)];
            if (!day) return;
            if (!availabilityByDay[day]) availabilityByDay[day] = [];
            availabilityByDay[day].push({
                startTime: String(row.start_time).slice(0, 5),
                endTime: String(row.end_time).slice(0, 5)
            });
        });
    }

    renderAvailabilitySlots();
}

function renderAvailabilitySummary(rows) {
    const byDay = new Map();
    rows.forEach(row => {
        const name = AVAILABILITY_DAY_NAMES[DB_WEEKDAY_TO_UI_DAY[Number(row.weekday)]];
        if (!name) return;
        const ranges = byDay.get(name) || [];
        ranges.push(`${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)}`);
        byDay.set(name, ranges);
    });

    if (!byDay.size) {
        return '<p class="field-description">Chưa có lịch rảnh.</p>';
    }

    return `<ul class="availability-summary">${[...byDay.entries()]
        .map(([day, ranges]) => `<li><strong>${day}</strong><span>${ranges.map(escapeHTML).join(", ")}</span></li>`)
        .join("")}</ul>`;
}

function getSelectedAvailabilityHours(ranges) {
    const hours = new Set();
    ranges.forEach(range => {
        for (let hour = 6; hour < 22; hour++) {
            const startTime = `${String(hour).padStart(2, "0")}:00`;
            const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
            if (range.startTime < endTime && range.endTime > startTime) {
                hours.add(hour);
            }
        }
    });
    return hours;
}

function renderAvailabilitySlots() {
    const container = document.getElementById("availabilitySlots");
    const hidden = document.getElementById("availabilityValue");
    if (!container) return;

    const scrollPositions = new Map(
        [...container.querySelectorAll("[data-availability-hour-list]")]
            .map(list => [list.dataset.availabilityHourList, list.scrollLeft])
    );
    const selectedDays = Object.keys(availabilityByDay)
        .filter(day => Object.hasOwn(AVAILABILITY_DAY_NAMES, day))
        .sort((a, b) => Number(a) - Number(b));
    document.querySelectorAll(".weekday-list [data-availability-day]").forEach(button => {
        const day = button.dataset.availabilityDay;
        button.classList.toggle("is-active", selectedDays.includes(day));
        button.classList.toggle("has-hours", Boolean(availabilityByDay[day]?.length));
        button.setAttribute("aria-pressed", String(selectedDays.includes(day)));
    });

    const normalized = Object.fromEntries(
        selectedDays.map(day => [day, availabilityByDay[day] || []])
    );
    if (hidden) hidden.value = JSON.stringify(normalized);

    if (!selectedDays.length) {
        container.innerHTML = '<p class="availability-prompt">Chọn một thứ ở trên để thiết lập khung giờ rảnh.</p>';
        return;
    }

    container.innerHTML = selectedDays.map(day => {
        const selectedHours = getSelectedAvailabilityHours(availabilityByDay[day] || []);
        return `
            <section class="availability-day-row">
                <div class="availability-day-heading">
                    <strong>${AVAILABILITY_DAY_NAMES[day]}</strong>
                    <span>Chọn giờ rảnh</span>
                </div>
                <div class="availability-hour-list" data-availability-hour-list="${day}" role="group" aria-label="Chọn giờ rảnh ${AVAILABILITY_DAY_NAMES[day]}">
                    ${Array.from({ length: 16 }, (_, index) => index + 6).map(hour => {
                        const time = `${String(hour).padStart(2, "0")}:00`;
                        const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
                        const selected = selectedHours.has(hour);
                        return `
                            <button type="button" class="availability-hour-option${selected ? " is-selected" : ""}"
                                    data-availability-hour="${hour}" data-day="${day}"
                                    aria-pressed="${selected}"
                                    aria-label="${time} đến ${endTime}">
                                ${time}
                            </button>
                        `;
                    }).join("")}
                </div>
            </section>
        `;
    }).join("") + '<p class="availability-help">Mỗi ô tương ứng 1 giờ. Chọn liên tiếp để tạo thành một khoảng giờ rảnh.</p>';

    container.querySelectorAll("[data-availability-hour-list]").forEach(list => {
        const scrollLeft = scrollPositions.get(list.dataset.availabilityHourList);
        if (scrollLeft !== undefined) list.scrollLeft = scrollLeft;
    });
}

document.addEventListener("click", event => {
    const dayButton = event.target.closest("[data-availability-day]");
    if (dayButton) {
        const day = dayButton.dataset.availabilityDay;
        if (Object.hasOwn(availabilityByDay, day)) {
            delete availabilityByDay[day];
        } else {
            availabilityByDay[day] = [];
        }
        renderAvailabilitySlots();
        return;
    }

    const hourButton = event.target.closest("[data-availability-hour]");
    if (hourButton) {
        const day = hourButton.dataset.day;
        const hour = Number(hourButton.dataset.availabilityHour);
        const selectedHours = getSelectedAvailabilityHours(availabilityByDay[day] || []);

        if (selectedHours.has(hour)) {
            selectedHours.delete(hour);
        } else {
            selectedHours.add(hour);
        }

        const sortedHours = [...selectedHours].sort((a, b) => a - b);
        const ranges = [];
        sortedHours.forEach(selectedHour => {
            const startTime = `${String(selectedHour).padStart(2, "0")}:00`;
            const endTime = `${String(selectedHour + 1).padStart(2, "0")}:00`;
            const previousRange = ranges[ranges.length - 1];
            if (previousRange && previousRange.endTime === startTime) {
                previousRange.endTime = endTime;
            } else {
                ranges.push({ startTime, endTime });
            }
        });
        availabilityByDay[day] = ranges;
        renderAvailabilitySlots();
    }
});

async function saveMemberAvailability() {
    const button = document.getElementById("saveAvailabilityButton");
    if (!currentMemberId || !button) return;
    if (!canUpdateMember(currentMemberId)) {
        showAvailabilityMessage("Bạn chỉ có thể cập nhật thời gian rảnh của chính mình.", "error");
        return;
    }

    const rows = [];
    for (const [day, ranges] of Object.entries(availabilityByDay)) {
        const sortedRanges = [...ranges].sort((a, b) => a.startTime.localeCompare(b.startTime));
        for (let index = 0; index < sortedRanges.length; index++) {
            const range = sortedRanges[index];
            if (!range.startTime || !range.endTime || range.endTime <= range.startTime) {
                showAvailabilityMessage("Mỗi khung giờ cần có giờ kết thúc sau giờ bắt đầu.", "error");
                return;
            }
            if (range.startTime < AVAILABILITY_START_LIMIT || range.endTime > AVAILABILITY_END_LIMIT) {
                showAvailabilityMessage("Khung giờ phải nằm trong khoảng 06:00–22:00.", "error");
                return;
            }
            if (index > 0 && range.startTime < sortedRanges[index - 1].endTime) {
                showAvailabilityMessage(`${AVAILABILITY_DAY_NAMES[day]} có các khung giờ bị chồng lấn.`, "error");
                return;
            }
            rows.push({
                member_id: currentMemberId,
                weekday: UI_DAY_TO_DB_WEEKDAY[day],
                start_time: range.startTime,
                end_time: range.endTime
            });
        }
    }

    const member = members.find(item => String(item.id) === String(currentMemberId));
    if (!member) {
        showAvailabilityMessage("Không tìm thấy thành viên cần cập nhật.", "error");
        return;
    }
    const previousRows = member.availability || [];
    button.disabled = true;
    button.textContent = "Đang lưu…";
    showAvailabilityMessage("");

    try {
        const { error: deleteError } = await window.supabaseClient
            .from("member_availability")
            .delete()
            .eq("member_id", currentMemberId);
        if (deleteError) throw deleteError;

        if (rows.length) {
            const { error: insertError } = await window.supabaseClient
                .from("member_availability")
                .insert(rows);
            if (insertError) {
                if (previousRows.length) {
                    const { error: restoreError } = await window.supabaseClient
                        .from("member_availability")
                        .insert(previousRows.map(({ member_id, weekday, start_time, end_time }) => ({
                            member_id, weekday, start_time, end_time
                        })));
                    if (restoreError) {
                        throw new Error(`Lưu lịch thất bại (${insertError.message}); khôi phục lịch cũ cũng thất bại (${restoreError.message}).`);
                    }
                }
                throw insertError;
            }
        }

        member.availability = rows;
        showAvailabilityMessage("Đã lưu thời gian rảnh.", "success");
        renderMemberDetail(member);
    } catch (error) {
        console.error("Không thể lưu thời gian rảnh:", error);
        showAvailabilityMessage(`Không lưu được thời gian rảnh: ${error.message}`, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Lưu thời gian rảnh";
    }
}

function showAvailabilityMessage(text, type = "") {
    const message = document.getElementById("availabilityMessage");
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-error", type === "error");
    message.classList.toggle("is-success", type === "success");
}

document.getElementById("saveAvailabilityButton")?.addEventListener("click", saveMemberAvailability);


// Mở/đóng danh sách nhóm và cập nhật thẻ khi checkbox thay đổi.
document.addEventListener("click", event => {
    const selectedContainer = event.target.closest("#selectedGroups");
    const optionsContainer = document.getElementById("groupOptions");

    if (selectedContainer && optionsContainer) {
        optionsContainer.hidden = !optionsContainer.hidden;
        selectedContainer.setAttribute("aria-expanded", String(!optionsContainer.hidden));
        return;
    }

    if (!event.target.closest("#groupSelect") && optionsContainer) {
        optionsContainer.hidden = true;
        const selected = document.getElementById("selectedGroups");
        if (selected) selected.setAttribute("aria-expanded", "false");
    }
});

document.addEventListener("change", event => {
    if (event.target.matches('#groupOptions input[name="groups"]')) {
        updateSelectedGroupsUI();
    }
});


/* =====================================================
   13. MODAL EVENTS
===================================================== */

document.addEventListener("click", event => {

    // Mở chi tiết thành viên
    const detailButton = event.target.closest(
        '[data-action="detail"]'
    );

    if (detailButton) {

        openMemberDetail(detailButton.dataset.id);

    }


    // Mở modal cập nhật
    const updateButton = event.target.closest(
        "#openUpdateMember"
    );

    if (updateButton) {

        openUpdateMemberModal(updateButton.dataset.id);

    }

    const removeMemberButton = event.target.closest("#removeMemberFromWorkspace");
    if (removeMemberButton) {
        removeWorkspaceMember(removeMemberButton.dataset.id, removeMemberButton);
    }


    // Đóng modal
    const closeButton = event.target.closest(
        "[data-close-modal], .close-modal, .cancel-btn"
    );

    if (closeButton) {

        const modal = closeButton.closest(".modal-overlay");

        if (modal) {
            modal.hidden = true;
        }

    }


    // Nhấn ra ngoài modal để đóng
    if (event.target.classList.contains("modal-overlay")) {

        event.target.hidden = true;

    }

});

async function removeWorkspaceMember(memberId, button) {
    const member = members.find(item => String(item.id) === String(memberId));
    if (!member) {
        window.alert("Không tìm thấy thành viên cần xóa.");
        return;
    }
    if (!currentUserCanManageWorkspace) {
        window.alert("Chỉ trưởng nhóm mới có thể xóa thành viên khác khỏi workspace.");
        return;
    }
    if (String(memberId) === String(currentAccountMemberId)) {
        window.alert("Bạn không thể tự xóa mình khỏi workspace.");
        return;
    }

    const confirmed = window.confirm(
        `Xóa ${member.name || "thành viên này"} khỏi workspace? Tài khoản và lịch sử công việc sẽ được giữ lại.`
    );
    if (!confirmed) return;

    button.disabled = true;
    button.textContent = "Đang xóa…";
    try {
        const { error } = await window.supabaseClient.rpc("remove_workspace_member", {
            p_member_id: String(memberId)
        });
        if (error) throw error;

        DOM.detailPanel.hidden = true;
        currentMemberId = null;
        await loadMembers();
        window.alert(`${member.name || "Thành viên"} đã được xóa khỏi workspace.`);
    } catch (error) {
        console.error("Không thể xóa thành viên khỏi workspace:", error);
        window.alert(`Không thể xóa thành viên khỏi workspace: ${error.message || "Lỗi Supabase không xác định."}`);
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.textContent = "Xóa thành viên";
        }
    }
}


/* =====================================================
   14. CREATE WORKSPACE MEMBER ACCOUNT
===================================================== */

async function createWorkspaceMemberAccount({
    memberName,
    email,
    initialPassword,
    accountRole
}) {
    const client = window.supabaseClient;
    if (!client?.functions?.invoke) {
        throw new Error("Supabase client chưa hỗ trợ gọi Edge Function.");
    }

    const { data, error } = await client.functions.invoke("create-workspace-member", {
        body: {
            memberName,
            email,
            initialPassword,
            accountRole,
            workspaceId: currentWorkspace.workspace_id
        }
    });

    if (error) {
        if (error.context instanceof Response) {
            const response = await error.context.clone().json().catch(() => null);
            if (typeof response?.error === "string") {
                throw new Error(response.error);
            }
        }
        throw error;
    }
    if (!data?.userId || !data?.memberId || data.workspaceId !== currentWorkspace.workspace_id) {
        throw new Error("Edge Function không trả về thông tin liên kết thành viên hợp lệ.");
    }

    return { requiresEmailConfirmation: false };
}

if (DOM.addForm) {

    DOM.addForm.addEventListener("submit", async event => {

        event.preventDefault();
        if (
            !currentUser?.id ||
            !currentWorkspace ||
            !currentUserCanManageWorkspace
        ) {
            setInvitationFeedback("Chỉ trưởng nhóm trong workspace mới có thể thêm thành viên.", "error");
            return;
        }

        const formData = new FormData(DOM.addForm);
        const memberName = String(formData.get("memberName") || "").trim();
        const email = String(formData.get("memberEmail") || "")
            .trim()
            .toLowerCase();
        const initialPassword = String(formData.get("initialPassword") || "");
        const accountRole = String(formData.get("accountRole") || "");
        if (
            !memberName ||
            memberName.length > 100 ||
            !email ||
            initialPassword.length < 8 ||
            initialPassword.length > 128 ||
            !["member", "leader"].includes(accountRole)
        ) {
            setInvitationFeedback("Vui lòng nhập họ tên, email hợp lệ, vai trò và mật khẩu từ 8 đến 128 ký tự.", "error");
            return;
        }
        if (email === String(currentUser.email || "").trim().toLowerCase()) {
            setInvitationFeedback("Bạn không thể gửi lời mời cho chính mình.", "error");
            return;
        }

        const submitButton = DOM.addForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        setInvitationFeedback("");
        try {
            const result = await createWorkspaceMemberAccount({
                memberName,
                email,
                initialPassword,
                accountRole
            });

            DOM.addForm.reset();
            await loadMembers();
            closeAddMemberModal();
            window.alert(result.requiresEmailConfirmation
                ? "Đã tạo tài khoản và thêm vào workspace. Thành viên cần xác nhận email trước khi đăng nhập."
                : "Đã tạo tài khoản và thêm thành viên vào workspace.");
        } catch (error) {
            console.error("Không thể tạo tài khoản thành viên:", error);
            setInvitationFeedback(
                error.message || "Không thể tạo tài khoản. Vui lòng thử lại.",
                "error"
            );
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });

}


/* =====================================================
   15. UPDATE MEMBER INFORMATION
===================================================== */

if (DOM.updateForm) {

    DOM.updateForm.addEventListener("submit", async event => {

        event.preventDefault();

        if (!currentMemberId) return;
        if (!canUpdateMember(currentMemberId)) {
            alert("Bạn chỉ có thể cập nhật thông tin của chính mình.");
            closeUpdateMemberModal();
            return;
        }

        const formData = new FormData(DOM.updateForm);
        const memberName = String(formData.get("memberName") || "").trim();
        const selectedGroups = [...new Set(formData.getAll("groups").map(String))];
        const submitButton = DOM.updateForm.querySelector('button[type="submit"]');
        const member = members.find(item =>
            String(item.id) === String(currentMemberId)
        );

        if (!member) {
            alert("Không tìm thấy thành viên cần cập nhật.");
            return;
        }
        if (!memberName) {
            document.getElementById("updateNameError").style.display = "block";
            document.getElementById("updateMemberName").focus();
            return;
        }

        const previousButtonText = submitButton?.textContent;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Đang lưu…";
        }

        try {
            const { data: updatedMember, error: memberError } = await window.supabaseClient
                .from("members")
                .update({ member_label: memberName })
                .eq("member_id", currentMemberId)
                .select("member_id");
            if (memberError) throw memberError;
            if (!updatedMember?.length) {
                throw new Error("Không có dữ liệu được cập nhật. Kiểm tra quyền cập nhật thành viên (RLS).");
            }

            const existingRoles = member.member_roles || [];
            const selectableGroups = new Set(
                [...DOM.updateForm.querySelectorAll('input[name="groups"]')]
                    .map(input => normalizeMemberGroup(input.value))
            );
            const selectedGroupSet = new Set(selectedGroups.map(normalizeMemberGroup));
            const removeRole = async role => {
                const { data, error } = await window.supabaseClient
                    .from("member_roles")
                    .delete()
                    .eq("member_id", currentMemberId)
                    .eq("role", role)
                    .select("role");
                if (error) throw error;
                if (!data?.length) {
                    throw new Error(`Không thể xóa vai trò "${role}". Kiểm tra quyền member_roles (RLS).`);
                }
            };

            for (const group of selectableGroups) {
                const matchingRoles = existingRoles.filter(item =>
                    normalizeMemberGroup(item.role) === group
                );
                const canonicalRole = matchingRoles.find(item => item.role === group);

                if (selectedGroupSet.has(group)) {
                    if (!canonicalRole && matchingRoles.length) {
                        const [roleToRename, ...duplicateRoles] = matchingRoles;
                        const { data: renamedRole, error: renameError } = await window.supabaseClient
                            .from("member_roles")
                            .update({ role: group })
                            .eq("member_id", currentMemberId)
                            .eq("role", roleToRename.role)
                            .select("role");
                        if (renameError) throw renameError;
                        if (!renamedRole?.length) {
                            throw new Error(`Không thể đồng bộ vai trò "${roleToRename.role}" thành "${group}". Kiểm tra quyền member_roles (RLS).`);
                        }

                        for (const duplicate of duplicateRoles) {
                            await removeRole(duplicate.role);
                        }
                    } else if (!matchingRoles.length) {
                        const { error: insertRoleError } = await window.supabaseClient
                            .from("member_roles")
                            .insert({
                                member_id: currentMemberId,
                                role: group,
                                in_roster: false,
                                n_tasks_assigned: 0
                            });
                        if (insertRoleError) throw insertRoleError;
                    } else {
                        for (const duplicate of matchingRoles) {
                            if (duplicate === canonicalRole) continue;
                            await removeRole(duplicate.role);
                        }
                    }
                } else {
                    for (const role of matchingRoles) {
                        await removeRole(role.role);
                    }
                }
            }

            const memberId = currentMemberId;
            closeUpdateMemberModal();
            await loadMembers();
            await openMemberDetail(memberId);
            if (String(memberId) === String(currentAccountMemberId) && window.appUser) {
                const updatedMember = members.find(item => String(item.id) === String(memberId));
                if (updatedMember) {
                    window.appUser = { ...window.appUser, name: updatedMember.name };
                    window.renderAppUser?.(window.appUser);
                }
            }

        } catch (error) {
            console.error("Không thể cập nhật thành viên:", error);
            alert(`Không thể cập nhật thông tin: ${error.message || "Lỗi Supabase không xác định."}`);
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = previousButtonText || "Lưu thành viên";
            }
        }

    });

}


/* =====================================================
   16. FORM HELPER
===================================================== */

function fillForm(form, data) {

    if (!form || !data) return;

    // Chuẩn hóa dữ liệu nhóm để hỗ trợ cả API trả về groups hoặc group.
    const groups = Array.isArray(data.groups)
        ? data.groups
        : (data.group ? String(data.group).split(",").map(item => item.trim()).filter(Boolean) : []);
    const formData = {
        ...data,
        memberName: data.memberName || data.name || data.member_label || "",
        groups: groups.map(normalizeMemberGroup)
    };

    Object.entries(formData).forEach(([key, value]) => {

        const field = form.elements.namedItem(key);

        if (!field) return;

        if (field instanceof RadioNodeList) {

            Array.from(field).forEach(input => {

                if (input.type === "checkbox") {
                    input.checked = Array.isArray(value)
                        ? value.includes(input.value)
                        : false;
                }

                if (input.type === "radio") {
                    input.checked = input.value === String(value);
                }

            });

        } else if (field.type === "checkbox") {

            field.checked = Boolean(value);

        } else if (field.type !== "file") {

            field.value = value ?? "";

        }

    });

    if (form.id === "updateMemberForm") {
        updateSelectedGroupsUI();
    }

}


/* =====================================================
   17. LOADING & ERROR STATES
===================================================== */

function showLoading() {

    if (!DOM.tableBody) return;

    DOM.tableBody.innerHTML = `
        <tr>
            <td colspan="6" style="text-align:center; padding:35px;">
                Đang tải danh sách thành viên...
            </td>
        </tr>
    `;

    if (DOM.emptyState) {
        DOM.emptyState.hidden = true;
    }

}


function showError(message) {

    if (!DOM.tableBody) return;

    DOM.tableBody.innerHTML = "";

    if (DOM.emptyState) {

        DOM.emptyState.hidden = false;

        const heading = DOM.emptyState.querySelector("h3");

        const description = DOM.emptyState.querySelector("p");

        if (heading) heading.textContent = "Không thể tải dữ liệu";

        if (description) description.textContent = message;

    }

    if (DOM.filteredCount) {
        DOM.filteredCount.textContent = "Lỗi tải dữ liệu";
    }

    if (DOM.footerInfo) {
        DOM.footerInfo.textContent = "Vui lòng thử tải lại trang";
    }

}


/* =====================================================
   18. UTILITY FUNCTIONS
===================================================== */

function getInitials(name = "") {

    return name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map(word => word.charAt(0).toUpperCase())
        .join("");

}


function escapeHTML(value = "") {

    return String(value).replace(/[&<>"']/g, character => {

        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];

    });

}


function refreshIcons() {

    if (window.lucide) {
        window.lucide.createIcons();
    }

}


/* =====================================================
   19. INITIALIZE
===================================================== */

document.addEventListener("DOMContentLoaded", () => {

    // Mặc định đóng toàn bộ modal
    document.querySelectorAll(".modal-overlay").forEach(modal => {
        modal.hidden = true;
    });

    // Đóng panel chi tiết
    if (DOM.detailPanel) {
        DOM.detailPanel.hidden = true;
    }

    // Khởi tạo icon
    refreshIcons();

    // Chọn và áp dụng bộ lọc mặc định ngay khi mở trang.
    setMemberFilter("all");

    // Tải dữ liệu thành viên từ API
    loadMembers();

});
