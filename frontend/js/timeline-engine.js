/**
 * AECPT - TIMELINE PLANNING ENGINE
 * Tích hợp toàn bộ thuật toán từ folder algorithm/:
 *  - Dependency check & Cycle Detection (Kahn's Algorithm)
 *  - Backward On-Air & Deadline calculation (fixed_days & dynamic)
 *  - Greedy MRV (Minimum Remaining Values) Member Assignment
 *  - Critical Path Method (CPM: ES, EF, LS, LF, Slack, Critical Path)
 *  - Supabase Persistence (events, tasks, task_assignments)
 */

(() => {
    "use strict";

    const EPS = 1e-9;
    const ONAIR_GAP_HOURS = { 1: 8, 2: 9, 3: 10 };

    class TimelineEngine {
        constructor() {
            this.membersCache = null;
        }

        /**
         * Lấy danh sách thành viên kèm vai trò thực tế từ Supabase
         */
        async fetchMembersWithRoles(client) {
            if (!client) client = window.supabaseClient;
            if (!client) return [];

            try {
                const [membersRes, rolesRes] = await Promise.all([
                    client.from("members").select("member_id, member_label, n_tasks_assigned, is_active").eq("is_active", true),
                    client.from("member_roles").select("member_id, role, in_roster")
                ]);

                if (membersRes.error) throw membersRes.error;

                const members = membersRes.data || [];
                const rolesData = rolesRes.data || [];

                const roleMap = new Map();
                rolesData.forEach(r => {
                    const mid = String(r.member_id);
                    if (!roleMap.has(mid)) roleMap.set(mid, []);
                    if (r.role) roleMap.get(mid).push(r.role.toLowerCase());
                });

                return members.map(m => ({
                    id: String(m.member_id),
                    name: m.member_label || m.member_id,
                    roles: roleMap.get(String(m.member_id)) || [],
                    load: Number(m.n_tasks_assigned) || 0
                }));
            } catch (err) {
                console.warn("[TimelineEngine] Lỗi tải thành viên từ Supabase, dùng mẫu dự phòng:", err);
                return [
                    { id: "MEM_01", name: "Member 01", roles: ["editor"], load: 2 },
                    { id: "MEM_02", name: "Member 02", roles: ["designer"], load: 10 },
                    { id: "MEM_05", name: "Member 05", roles: ["designer", "photographer"], load: 4 },
                    { id: "MEM_15", name: "Member 15", roles: ["editor", "technician"], load: 3 },
                    { id: "MEM_22", name: "Member 22", roles: ["content_writer"], load: 5 },
                    { id: "MEM_24", name: "Member 24", roles: ["technician"], load: 2 },
                    { id: "MEM_29", name: "Member 29", roles: ["content_writer"], load: 4 },
                    { id: "MEM_40", name: "Member 40", roles: ["designer"], load: 3 },
                    { id: "MEM_41", name: "Member 41", roles: ["designer"], load: 6 }
                ];
            }
        }

        /**
         * Kiểm tra phụ thuộc và tìm các tầng topo (Kahn's algorithm)
         */
        checkDependency(tasks) {
            const ids = new Set(tasks.map(t => t.id));
            const problems = [];

            tasks.forEach(t => {
                (t.depends_on || []).forEach(d => {
                    if (d === t.id) problems.push(`${t.id} phụ thuộc chính nó`);
                    else if (!ids.has(d)) problems.push(`${t.id} phụ thuộc id không tồn tại: ${d}`);
                });
            });

            const valid = {};
            tasks.forEach(t => {
                valid[t.id] = (t.depends_on || []).filter(d => ids.has(d) && d !== t.id);
            });

            const indeg = {};
            const children = {};
            tasks.forEach(t => {
                indeg[t.id] = valid[t.id].length;
                children[t.id] = [];
            });

            tasks.forEach(t => {
                valid[t.id].forEach(d => children[d].push(t.id));
            });

            let cur = tasks.map(t => t.id).filter(id => indeg[id] === 0).sort();
            const layers = [];
            const done = new Set();

            while (cur.length) {
                layers.push(cur);
                const nextQueue = [];
                cur.forEach(u => {
                    done.add(u);
                    children[u].forEach(v => {
                        indeg[v]--;
                        if (indeg[v] === 0) nextQueue.push(v);
                    });
                });
                cur = nextQueue.sort();
            }

            const remaining = tasks.map(t => t.id).filter(id => !done.has(id));
            let cycle = [];
            if (remaining.length) {
                let startNode = remaining.sort()[0];
                const seen = [];
                while (!seen.includes(startNode)) {
                    seen.push(startNode);
                    const nextNodes = valid[startNode].filter(d => remaining.includes(d));
                    startNode = nextNodes.length ? nextNodes.sort()[0] : seen[0];
                }
                cycle = [...seen.slice(seen.indexOf(startNode)), startNode];
                problems.push("Vòng phụ thuộc: " + cycle.join(" -> "));
            }

            return {
                ok: problems.length === 0,
                problems,
                cycle,
                layers
            };
        }

        /**
         * Tính toán Deadline và On-Air (ngược từ event_start)
         */
        computeDeadlinesAndOnAir(tasks, planStart, eventStart, eventEnd) {
            const PS = new Date(planStart).getTime();
            const ES = new Date(eventStart).getTime();
            const byId = new Map(tasks.map(t => [t.id, t]));
            const childrenMap = new Map();
            tasks.forEach(t => childrenMap.set(t.id, []));
            tasks.forEach(t => {
                (t.depends_on || []).forEach(d => {
                    if (byId.has(d)) childrenMap.get(d).push(t);
                });
            });

            const depRes = this.checkDependency(tasks);
            const topoOrder = depRes.layers.flat();

            // 1. Việc live (start == 'event') gán on_air = eventStart
            tasks.forEach(t => {
                t.flags = t.flags || [];
                if (t.start === "event" || t.is_live) {
                    t.is_live = true;
                    t.on_air = new Date(ES);
                    t.deadline = null;
                    t.feedback_due = null;
                    if (!t.flags.includes("LIVE")) t.flags.push("LIVE");
                }
            });

            // 2. Suy ngược on-air cho các việc trước sự kiện
            [...topoOrder].reverse().forEach(tid => {
                const t = byId.get(tid);
                if (t.is_live) return;

                let onAirTime = t.on_air ? new Date(t.on_air).getTime() : ES;
                if (!t.on_air) {
                    const children = childrenMap.get(tid) || [];
                    children.forEach(c => {
                        if (c.deadline) {
                            const cDurMs = (c.duration || 1) * 3600 * 1000;
                            onAirTime = Math.min(onAirTime, new Date(c.deadline).getTime() - cDurMs);
                        }
                    });
                    t.on_air = new Date(onAirTime);
                    if (!t.flags.includes("ON_AIR_AUTO")) t.flags.push("ON_AIR_AUTO");
                }

                // 3. Tính hạn nộp nháp (draft deadline) và feedback
                const complexity = Math.min(Math.max(Number(t.complexity) || 2, 1), 3);
                const draftDaysBefore = complexity >= 3 ? 2 : 1;
                const draftMs = onAirTime - draftDaysBefore * 24 * 3600 * 1000;
                t.deadline = new Date(draftMs);

                const gapHours = ONAIR_GAP_HOURS[complexity] || 9;
                t.feedback_due = new Date(onAirTime - gapHours * 3600 * 1000);

                if (draftMs <= PS) {
                    if (!t.flags.includes("INFEASIBLE")) t.flags.push("INFEASIBLE");
                } else if ((draftMs - PS) / 3600000 < (t.duration || 1)) {
                    if (!t.flags.includes("COMPRESSED")) t.flags.push("COMPRESSED");
                }
            });
        }

        /**
         * Phân công công việc (Greedy Heuristic: MRV - task hiếm xếp trước)
         */
        assignMembers(tasks, members) {
            const roleNormalization = {
                content: "content_writer",
                content_writer: "content_writer",
                design: "designer",
                designer: "designer",
                photo: "photographer",
                photographer: "photographer",
                video: "editor",
                editor: "editor",
                tech: "technician",
                technician: "technician"
            };

            const memberLoads = new Map(members.map(m => [m.id, m.load || 0]));

            const isEligible = (m, t) => {
                if (!t.roles_required || !t.roles_required.length) return true;
                const required = t.roles_required.map(r => roleNormalization[r.toLowerCase()] || r.toLowerCase());
                const mRoles = (m.roles || []).map(r => roleNormalization[r.toLowerCase()] || r.toLowerCase());
                return required.some(r => mRoles.includes(r));
            };

            const depRes = this.checkDependency(tasks);
            const layers = depRes.layers;

            layers.forEach(layer => {
                const pending = layer.map(id => tasks.find(t => t.id === id)).filter(Boolean);

                while (pending.length) {
                    // Sắp xếp: task ít ứng viên nhất xếp trước (MRV)
                    pending.sort((a, b) => {
                        const candsA = members.filter(m => isEligible(m, a)).length;
                        const candsB = members.filter(m => isEligible(m, b)).length;
                        if (candsA !== candsB) return candsA - candsB;
                        const dlA = a.deadline ? new Date(a.deadline).getTime() : Infinity;
                        const dlB = b.deadline ? new Date(b.deadline).getTime() : Infinity;
                        return dlA - dlB;
                    });

                    const t = pending.shift();
                    const candidates = members.filter(m => isEligible(m, t));

                    // Xếp theo tải công việc hiện tại (ít việc hơn được ưu tiên)
                    candidates.sort((a, b) => {
                        const loadA = memberLoads.get(a.id) || 0;
                        const loadB = memberLoads.get(b.id) || 0;
                        return loadA - loadB;
                    });

                    if (candidates.length > 0) {
                        t.assignee = candidates[0].id;
                        t.assignee_name = candidates[0].name;
                        memberLoads.set(t.assignee, (memberLoads.get(t.assignee) || 0) + 1);

                        if (candidates.length > 1) {
                            t.backup = candidates[1].id;
                            t.backup_name = candidates[1].name;
                        } else {
                            t.backup = null;
                            t.backup_name = null;
                        }
                    } else {
                        t.assignee = null;
                        t.assignee_name = "Chưa có ứng viên phù hợp";
                        t.backup = null;
                        t.backup_name = null;
                        t.flags = t.flags || [];
                        if (!t.flags.includes("NO_ROLE_MATCH")) t.flags.push("NO_ROLE_MATCH");
                    }
                }
            });
        }

        /**
         * Tính toán đường găng (Critical Path Method - CPM)
         */
        computeCPM(tasks, planStart, eventStart) {
            const PS = new Date(planStart).getTime();
            const ES_TIME = new Date(eventStart).getTime();
            const byId = new Map(tasks.map(t => [t.id, t]));
            const depRes = this.checkDependency(tasks);
            const order = depRes.layers.flat();

            const childrenMap = new Map();
            tasks.forEach(t => childrenMap.set(t.id, []));
            tasks.forEach(t => {
                (t.depends_on || []).forEach(d => {
                    if (byId.has(d)) childrenMap.get(d).push(t.id);
                });
            });

            // Forward pass: ES, EF
            const ES = {};
            const EF = {};
            order.forEach(id => {
                const t = byId.get(id);
                const deps = (t.depends_on || []).filter(d => d in EF);
                let es = deps.length ? Math.max(...deps.map(d => EF[d])) : 0.0;

                if (t.is_live) {
                    const eventOffsetHours = Math.max((ES_TIME - PS) / 3600000, 0);
                    es = Math.max(es, eventOffsetHours);
                }

                const dur = Number(t.duration) || 1.0;
                ES[id] = es;
                EF[id] = es + dur;
            });

            const totalHours = Math.max(0, ...Object.values(EF));

            // Backward pass: LF, LS
            const LF = {};
            const LS = {};
            [...order].reverse().forEach(id => {
                const t = byId.get(id);
                const dur = Number(t.duration) || 1.0;
                const children = childrenMap.get(id) || [];
                let lf = children.length ? Math.min(...children.map(c => LS[c])) : totalHours;

                if (t.deadline) {
                    const dlHours = (new Date(t.deadline).getTime() - PS) / 3600000;
                    lf = Math.min(lf, dlHours);
                }

                LF[id] = lf;
                LS[id] = lf - dur;
            });

            const schedule = {};
            const criticalPath = [];
            order.forEach(id => {
                const slack = LS[id] - ES[id];
                const isCritical = slack <= 0.05;
                schedule[id] = {
                    ES: ES[id],
                    EF: EF[id],
                    LS: LS[id],
                    LF: LF[id],
                    slack: Math.round(slack * 10) / 10,
                    isCritical
                };
                if (isCritical) criticalPath.push(id);
            });

            return {
                schedule,
                totalHours: Math.round(totalHours * 10) / 10,
                criticalPath
            };
        }

        /**
         * Chạy trọn vẹn thuật toán lập kế hoạch
         */
        async planTimeline(eventData, rawTasks) {
            if (!rawTasks || rawTasks.length < 1) {
                throw new Error("Cần có ít nhất 1 công việc (task) để bắt đầu tạo timeline.");
            }

            const client = window.supabaseClient;
            const members = await this.fetchMembersWithRoles(client);

            const planStart = eventData.plan_start || new Date();
            const eventStart = new Date(eventData.event_start || (Date.now() + 7 * 86400000));
            const eventEnd = new Date(eventData.event_end || (eventStart.getTime() + 12 * 3600000));

            // Chuẩn hóa danh sách task
            const tasks = rawTasks.map((t, idx) => ({
                id: t.id || `T_${idx + 1}`,
                name: t.name || t.task_title || `Công việc ${idx + 1}`,
                duration: Number(t.duration) || (t.duration?.endsWith?.("d") ? parseFloat(t.duration) * 24 : 4),
                effort: t.effort ? Number(t.effort) : null,
                roles_required: Array.isArray(t.roles) ? t.roles : (t.roles ? String(t.roles).split(/[;,]/).map(s => s.trim()) : []),
                depends_on: Array.isArray(t.depends_on) ? t.depends_on : (t.depends_on ? String(t.depends_on).split(/[;,]/).map(s => s.trim()) : []),
                complexity: Number(t.complexity) || 2,
                start: t.start || (t.is_live ? "event" : ""),
                is_live: Boolean(t.is_live || t.start === "event"),
                on_air: t.on_air ? new Date(t.on_air) : null,
                flags: []
            }));

            // 1. Kiểm tra vòng lặp
            const depCheck = this.checkDependency(tasks);
            if (!depCheck.ok) {
                return {
                    ok: false,
                    error: `Lỗi phụ thuộc trong các công việc: ${depCheck.problems.join("; ")}`
                };
            }

            // 2. Tính On-Air & Deadlines
            this.computeDeadlinesAndOnAir(tasks, planStart, eventStart, eventEnd);

            // 3. Phân công Greedy
            this.assignMembers(tasks, members);

            // 4. Tính toán CPM Timeline
            const cpm = this.computeCPM(tasks, planStart, eventStart);

            return {
                ok: true,
                event: {
                    ...eventData,
                    plan_start: planStart,
                    event_start: eventStart,
                    event_end: eventEnd
                },
                tasks,
                cpm,
                members
            };
        }

        /**
         * Lưu toàn bộ kế hoạch vào cơ sở dữ liệu Supabase
         */
        async savePlanToSupabase(plan) {
            const client = window.supabaseClient;
            if (!client) {
                throw new Error("Không tìm thấy kết nối Supabase. Vui lòng kiểm tra lại cấu hình.");
            }

            const { event, tasks } = plan;
            const { data: { user }, error: userError } = await client.auth.getUser();
            if (userError) throw userError;
            if (!user) throw new Error("Vui lòng đăng nhập để lưu sự kiện.");
            const workspace = await window.ensurePersonalWorkspace(user);

            // 1. Tìm mã Event ID kế tiếp
            let targetEventId = event.event_id;
            if (!targetEventId) {
                const { data: latestEvents } = await client
                    .from("events")
                    .select("event_id")
                    .order("event_id", { ascending: false })
                    .limit(1);

                let nextNum = 12;
                if (latestEvents && latestEvents.length) {
                    const match = latestEvents[0].event_id.match(/\d+/);
                    if (match) nextNum = parseInt(match[0], 10) + 1;
                }
                targetEventId = `EVT_${String(nextNum).padStart(2, "0")}`;
            }

            const onAirDates = tasks.map(t => t.on_air ? t.on_air.toISOString().split("T")[0] : null).filter(Boolean);
            const firstOnAir = onAirDates.length ? onAirDates.sort()[0] : new Date(event.event_start).toISOString().split("T")[0];
            const lastOnAir = onAirDates.length ? onAirDates.sort().slice(-1)[0] : new Date(event.event_end).toISOString().split("T")[0];

            // 2. Chèn / cập nhật bảng events
            const eventPayload = {
                event_id: targetEventId,
                event_label: event.event_label || `Sự kiện ${targetEventId}`,
                event_category: event.event_category || "event",
                category_note: event.category_note || event.description || "Lập kế hoạch tự động bởi AI Assistant",
                n_tasks: tasks.length,
                first_on_air_date: firstOnAir,
                last_on_air_date: lastOnAir,
                workspace_id: workspace.workspace_id,
                status: event.status || "draft"
            };

            const { error: eventError } = await client
                .from("events")
                .upsert(eventPayload, { onConflict: "event_id" });

            if (eventError) {
                console.warn("[TimelineEngine] Không thể lưu bảng events (có thể do quyền RLS):", eventError);
            }

            // 3. Tìm số task_no cao nhất hiện có
            const { data: latestTask } = await client
                .from("tasks")
                .select("task_no")
                .order("task_no", { ascending: false })
                .limit(1);

            let nextTaskNo = 154;
            if (latestTask && latestTask.length && latestTask[0].task_no) {
                nextTaskNo = latestTask[0].task_no + 1;
            }

            // 4. Lưu từng task vào bảng tasks
            const taskInserts = [];
            const assignmentInserts = [];
            const taskIdByReference = new Map(tasks.map((task, index) => [
                String(task.id),
                `T${String(nextTaskNo + index).padStart(3, "0")}`
            ]));

            tasks.forEach((t, i) => {
                const currentNo = nextTaskNo + i;
                const taskId = `T${String(currentNo).padStart(3, "0")}`;
                t.db_task_id = taskId;
                t.db_task_no = currentNo;

                const onAirIso = t.on_air ? t.on_air.toISOString() : null;
                const deadlineIso = t.deadline ? t.deadline.toISOString() : null;

                const onAirDate = onAirIso ? onAirIso.split("T")[0] : null;
                const onAirTime = onAirIso ? onAirIso.split("T")[1].slice(0, 8) : null;
                const deadlineDate = deadlineIso ? deadlineIso.split("T")[0] : onAirDate;
                const deadlineTime = deadlineIso ? deadlineIso.split("T")[1].slice(0, 8) : onAirTime;

                const roleName = (t.roles_required && t.roles_required[0]) || "general";
                let taskType = "Product";
                if (roleName.includes("content")) taskType = "OnPage";
                else if (roleName.includes("photo") || roleName.includes("video") || roleName.includes("editor")) taskType = "Media";

                taskInserts.push({
                    task_id: taskId,
                    task_no: currentNo,
                    event_id: targetEventId,
                    task_title: t.name,
                    task_type: taskType,
                    submission_label: `${i + 1}. ${t.name}`,
                    description: `Độ phức tạp: ${t.complexity || 2}/3. Thời lượng: ${t.duration}h. Phụ thuộc: ${(t.depends_on || []).map(id => taskIdByReference.get(String(id)) || id).join(", ") || "Không"}.`,
                    on_air_date: onAirDate,
                    on_air_time: onAirTime,
                    on_air_at: onAirIso,
                    package_deadline_date: deadlineDate,
                    package_deadline_time: deadlineTime,
                    package_deadline_at: deadlineIso,
                    is_cancelled: false,
                    post_done: false,
                    status: "todo",
                    progress: 0
                });

                if (t.assignee) {
                    assignmentInserts.push({
                        task_id: taskId,
                        role: roleName,
                        member_id: t.assignee,
                        assignment_state: "assigned",
                        is_done: false
                    });
                }
            });

            const { error: tasksError } = await client.from("tasks").insert(taskInserts);
            if (tasksError) {
                console.error("[TimelineEngine] Lỗi lưu tasks vào Supabase:", tasksError);
                throw new Error(`Lỗi khi lưu danh sách công việc vào Supabase: ${tasksError.message}`);
            }

            if (assignmentInserts.length) {
                const { error: assignError } = await client.from("task_assignments").insert(assignmentInserts);
                if (assignError) {
                    console.warn("[TimelineEngine] Lỗi lưu phân công vào Supabase:", assignError);
                }
            }

            return {
                ok: true,
                event_id: targetEventId,
                event_label: eventPayload.event_label,
                task_count: tasks.length,
                tasks: taskInserts
            };
        }
    }

    window.TimelineEngine = new TimelineEngine();
})();
