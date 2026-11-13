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

    /**
     * Khung giờ làm việc 07:00 - 22:00 (workhours.py - Bản 3)
     * Đảm bảo hạn nộp nháp, feedback và on-air nằm trong khung giờ làm việc hợp lệ.
     */
    function toWorkWindow(date, avoidSunday = false) {
        if (!date) return date;
        const d = new Date(date);
        const h = d.getHours();
        const m = d.getMinutes();
        const s = d.getSeconds();

        if (h < 7) {
            d.setHours(7, 0, 0, 0);
        } else if (h > 22 || (h === 22 && (m > 0 || s > 0))) {
            d.setHours(22, 0, 0, 0);
        }

        if (avoidSunday && d.getDay() === 0) {
            d.setDate(d.getDate() - 1);
            d.setHours(22, 0, 0, 0);
        }
        return d;
    }

    class TimelineEngine {
        constructor() {
            this.membersCache = null;
        }

        /**
         * Lấy danh sách thành viên kèm vai trò thực tế từ Supabase
         */
        async fetchMembersWithRoles(client) {
            if (!client) client = window.supabaseClient;

            const fallbackMembers = [
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

            if (!client) return fallbackMembers;

            try {
                const [membersRes, rolesRes] = await Promise.all([
                    client.from("members").select("member_id, member_label, n_tasks_assigned, is_active").eq("is_active", true),
                    client.from("member_roles").select("member_id, role, in_roster")
                ]);

                if (membersRes.error) throw membersRes.error;

                const members = membersRes.data || [];
                const rolesData = rolesRes.data || [];

                if (!members.length) return fallbackMembers;

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
                return fallbackMembers;
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
         * Tính toán Deadline và On-Air dựa trên Ngày bắt đầu giao task (planStart)
         * - planStart: Ngày bắt đầu giao các task cho thành viên triển khai (mốc xuất phát T0)
         * - Mọi mốc hạn nộp nháp, hạn feedback, ngày on-air đều diễn ra TỪ NGÀY GIAO TASK TRỞ ĐI
         * - Áp dụng khung giờ làm việc 07:00 - 22:00 và lead time 48h cho ấn phẩm in ấn (Bản 3)
         */
        computeDeadlinesAndOnAir(tasks, planStart, eventStart, eventEnd) {
            const PS = new Date(planStart).getTime();
            const ES = new Date(eventStart).getTime();
            const EE = new Date(eventEnd).getTime();
            const byId = new Map(tasks.map(t => [t.id, t]));

            const depRes = this.checkDependency(tasks);
            const topoOrder = depRes.layers.flat();

            // 1. Việc live tại sự kiện (start == 'event' hoặc is_live hoặc category == 'onsite')
            tasks.forEach(t => {
                t.flags = t.flags || [];
                if (t.start === "event" || t.is_live || t.category === "onsite") {
                    t.is_live = true;
                    t.on_air = new Date(Math.max(ES, PS));
                    t.deadline = null;
                    t.feedback_due = null;
                    if (!t.flags.includes("LIVE")) t.flags.push("LIVE");
                }
            });

            // 2. Tính toán tịnh tiến các công việc chuẩn bị từ ngày bắt đầu giao task (planStart)
            topoOrder.forEach(tid => {
                const t = byId.get(tid);
                if (t.is_live) return;

                // Thời điểm sớm nhất có thể bắt đầu làm task (sau khi các task phụ thuộc đã có feedback/deadline)
                const prereqTimes = (t.depends_on || []).map(d => {
                    const p = byId.get(d);
                    return p?.feedback_due?.getTime() || p?.deadline?.getTime() || p?.on_air?.getTime() || PS;
                });
                const taskStartMs = prereqTimes.length ? Math.max(...prereqTimes) : PS;

                const complexity = Math.min(Math.max(Number(t.complexity) || 2, 1), 3);
                const draftWorkDays = complexity >= 3 ? 2 : 1;
                const isProduct = t.category === "product" || /standee|banner|in |móc khóa|giấy chứng nhận|kỷ yếu/i.test(t.name);
                const printLeadHours = isProduct ? 48 : 0; // Vật phẩm in ấn: cộng thêm 2 ngày chuẩn bị và in ấn

                // Nếu task đã có on_air cụ thể và on_air đó nằm sau taskStartMs
                if (t.on_air && new Date(t.on_air).getTime() > taskStartMs) {
                    const onAirTime = new Date(t.on_air).getTime();
                    const gapHours = ONAIR_GAP_HOURS[complexity] || 9;
                    const rawFbMs = onAirTime - (gapHours + printLeadHours) * 3600 * 1000;
                    t.feedback_due = toWorkWindow(new Date(rawFbMs));

                    const rawDraftMs = onAirTime - (draftWorkDays * 24 + printLeadHours) * 3600 * 1000;
                    if (rawDraftMs <= taskStartMs) {
                        t.deadline = toWorkWindow(new Date(taskStartMs + Math.max(t.duration || 4, 8) * 3600 * 1000));
                        t.flags.push("COMPRESSED");
                    } else {
                        t.deadline = toWorkWindow(new Date(rawDraftMs));
                    }
                } else {
                    // Tự động tính tiến dần từ ngày bắt đầu giao task (planStart)
                    const workDurationMs = Math.max(Number(t.duration) || 4, draftWorkDays * 24) * 3600 * 1000;
                    const rawDraftMs = taskStartMs + workDurationMs;
                    t.deadline = toWorkWindow(new Date(rawDraftMs));

                    // Hạn Feedback: sau hạn nộp nháp
                    const gapHours = ONAIR_GAP_HOURS[complexity] || 9;
                    const rawFbMs = t.deadline.getTime() + gapHours * 3600 * 1000;
                    t.feedback_due = toWorkWindow(new Date(rawFbMs));

                    // Ngày On-air: sau feedback (+ lead time 48h nếu là ấn phẩm in ấn)
                    const rawOnAirMs = t.feedback_due.getTime() + (printLeadHours + 8) * 3600 * 1000;
                    t.on_air = toWorkWindow(new Date(rawOnAirMs));
                    if (!t.flags.includes("ON_AIR_AUTO")) t.flags.push("ON_AIR_AUTO");
                }

                if (t.start === "creation" && !t.flags.includes("START_NOW")) {
                    t.flags.push("START_NOW");
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
         * Xử lý trùng giờ (conflicts.py - Bản 3):
         * Quét các task của CÙNG MỘT NGƯỜI có khung giờ (ES, EF) trùng nhau.
         * Nếu trùng, tự động chuyển người đó sang vị trí Backup nếu có người dự phòng phù hợp.
         */
        resolveConflicts(tasks, cpm) {
            const schedule = cpm.schedule || {};
            const grouped = new Map();
            const notes = [];

            tasks.forEach(t => {
                if (!t.assignee || !schedule[t.id]) return;
                const s = schedule[t.id];
                const esKey = Math.round(s.ES * 10) / 10;
                const efKey = Math.round(s.EF * 10) / 10;
                const key = `${t.assignee}_${esKey}_${efKey}`;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(t);
            });

            grouped.forEach((taskList) => {
                if (taskList.length > 1) {
                    for (let i = 1; i < taskList.length; i++) {
                        const conflictTask = taskList[i];
                        if (conflictTask.backup && conflictTask.backup !== conflictTask.assignee) {
                            const prevAssigneeName = conflictTask.assignee_name;
                            conflictTask.assignee = conflictTask.backup;
                            conflictTask.assignee_name = conflictTask.backup_name;
                            conflictTask.flags = conflictTask.flags || [];
                            if (!conflictTask.flags.includes("CONFLICT_RESOLVED")) {
                                conflictTask.flags.push("CONFLICT_RESOLVED");
                            }
                            notes.push(`Task ${conflictTask.id} (${conflictTask.name}): chuyển sang người dự phòng ${conflictTask.backup_name} để tránh trùng giờ với ${taskList[0].id} (${prevAssigneeName})`);
                        }
                    }
                }
            });

            return notes;
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

            // 1. Ngày bắt đầu giao các task (plan_start):
            // Chính là ngày bắt đầu sự kiện / bắt đầu giao việc mà người dùng cung cấp khi AI hỏi
            const rawPlanStart = eventData.plan_start || eventData.start_date || eventData.event_start;
            const planStart = rawPlanStart ? new Date(rawPlanStart) : new Date();

            // 2. Ngày kết thúc sự kiện (event_end):
            const rawEventEnd = eventData.event_end || eventData.end_date;
            const eventEnd = rawEventEnd ? new Date(rawEventEnd) : new Date(planStart.getTime() + 7 * 86400000);

            // 3. Ngày diễn ra sự kiện chính / offline (event_start):
            // Nếu có sự kiện offline riêng biệt thì dùng event_start, nếu không thì dùng eventEnd
            const eventStart = (eventData.event_start && eventData.plan_start && eventData.event_start !== eventData.plan_start)
                ? new Date(eventData.event_start)
                : eventEnd;

            // Chuẩn hóa danh sách task
            const tasks = rawTasks.map((t, idx) => ({
                id: t.id || `T_${idx + 1}`,
                name: t.name || t.task_title || `Công việc ${idx + 1}`,
                category: t.category || (/standee|banner|móc khóa|in /i.test(t.name) ? "product" : (t.start === "event" || t.is_live ? "onsite" : "onpage")),
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

            // 2. Tính On-Air & Deadlines (kèm khung giờ làm việc 07:00-22:00 Bản 3)
            this.computeDeadlinesAndOnAir(tasks, planStart, eventStart, eventEnd);

            // 3. Phân công Greedy
            this.assignMembers(tasks, members);

            // 4. Tính toán CPM Timeline
            const cpm = this.computeCPM(tasks, planStart, eventStart);

            // 5. Xử lý trùng lịch (conflicts.py - Bản 3)
            const conflictNotes = this.resolveConflicts(tasks, cpm);

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
                conflictNotes,
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

            const { event, tasks, members } = plan;

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
            const firstOnAir = onAirDates.length ? onAirDates.sort()[0] : new Date(event.plan_start || event.event_start).toISOString().split("T")[0];
            const lastOnAir = onAirDates.length ? onAirDates.sort().slice(-1)[0] : new Date(event.event_end || event.event_start).toISOString().split("T")[0];

            // 2. Chèn / cập nhật bảng events
            const eventPayload = {
                event_id: targetEventId,
                event_label: event.event_label || `Sự kiện ${targetEventId}`,
                event_category: event.event_category || "event",
                category_note: event.category_note || event.description || "Lập kế hoạch tự động bởi AI Assistant",
                n_tasks: tasks.length,
                first_on_air_date: firstOnAir,
                last_on_air_date: lastOnAir,
                is_completed: false
            };

            const { error: eventError } = await client
                .from("events")
                .upsert(eventPayload, { onConflict: "event_id" });

            if (eventError) {
                console.warn("[TimelineEngine] Không thể lưu bảng events (có thể do quyền RLS):", eventError);
            }

            // 3. Tìm số task_no cao nhất hiện có (bỏ qua null để tránh lỗi sắp xếp)
            const { data: latestTask } = await client
                .from("tasks")
                .select("task_no")
                .not("task_no", "is", null)
                .order("task_no", { ascending: false })
                .limit(1);

            let nextTaskNo = 154;
            if (latestTask && latestTask.length && latestTask[0].task_no) {
                nextTaskNo = latestTask[0].task_no + 1;
            }

            // 4. Lưu từng task vào bảng tasks
            const taskInserts = [];
            const assignmentInserts = [];

            const formatLocalParts = (dateObj) => {
                if (!dateObj) return { date: null, time: null, iso: null };
                const d = new Date(dateObj);
                const pad = (n) => String(n).padStart(2, "0");
                return {
                    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
                    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
                    iso: d.toISOString()
                };
            };

            tasks.forEach((t, i) => {
                const currentNo = nextTaskNo + i;
                const taskId = `T${String(currentNo).padStart(3, "0")}`;
                t.db_task_id = taskId;
                t.db_task_no = currentNo;

                const onAir = formatLocalParts(t.on_air);
                const deadline = formatLocalParts(t.deadline);

                const onAirIso = onAir.iso;
                const deadlineIso = deadline.iso;
                const onAirDate = onAir.date;
                const onAirTime = onAir.time;
                const deadlineDate = deadline.date || onAirDate;
                const deadlineTime = deadline.time || onAirTime;

                const DB_ROLE_MAP = {
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
                const rawRole = (t.roles_required && t.roles_required[0]) || "";
                const memberObj = Array.isArray(members) ? members.find(m => m.id === t.assignee) : null;
                const fallbackRole = (memberObj?.roles && memberObj.roles[0]) || "content_writer";
                const dbRole = DB_ROLE_MAP[rawRole.toLowerCase()] || DB_ROLE_MAP[fallbackRole.toLowerCase()] || "content_writer";

                let taskType = "Product";
                if (dbRole.includes("content")) taskType = "OnPage";
                else if (dbRole.includes("photo") || dbRole.includes("video") || dbRole.includes("editor")) taskType = "Media";

                taskInserts.push({
                    task_id: taskId,
                    task_no: currentNo,
                    event_id: targetEventId,
                    task_title: t.name,
                    task_type: taskType,
                    submission_label: `${i + 1}. ${t.name}`,
                    description: `Độ phức tạp: ${t.complexity || 2}/3. Thời lượng: ${t.duration}h. Phụ thuộc: ${(t.depends_on || []).join(", ") || "Không"}.`,
                    on_air_date: onAirDate,
                    on_air_time: onAirTime,
                    on_air_at: onAirIso,
                    package_deadline_date: deadlineDate,
                    package_deadline_time: deadlineTime,
                    package_deadline_at: deadlineIso,
                    is_cancelled: false,
                    post_done: false,
                    status: "not_started",
                    progress: 0
                });

                if (t.assignee) {
                    assignmentInserts.push({
                        task_id: taskId,
                        role: dbRole,
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

