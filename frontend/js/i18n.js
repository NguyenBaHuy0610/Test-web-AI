(() => {
    const STORAGE_KEY = "aecpt_language";
    const translations = {
        "Trang chủ | AECPT": "Home | AECPT",
        "Trang chủ": "Home",
        "Task Management": "Quản lý công việc",
        "Đang chuyển đến trang đăng nhập...": "Redirecting to sign in...",
        "Trang tiếp theo": "Next page",
        "Event": "Event",
        "Cùng trợ lý AI bắt đầu công việc của ban Multimedia.": "Work with the AI assistant to get your Multimedia team started.",
        "Chưa có sự kiện đang diễn ra": "No active event",
        "Tạo sự kiện để cùng AI lên kế hoạch và phối hợp công việc.": "Create an event to plan and coordinate work with AI.",
        "+ Tạo sự kiện": "+ Create event",
        "Sự kiện hiện tại": "Current event",
        "Đang diễn ra": "In progress",
        "Mô tả sự kiện...": "Event description...",
        "0 công việc": "0 tasks",
        "Hoàn tất sự kiện": "Complete event",
        "Trợ lý AI": "AI assistant",
        "Đồng hành cùng sự kiện của bạn": "Your event planning companion",
        "Chào": "Hello",
        "bạn": "there",
        "! Mình là trợ lý AI của ban Multimedia. Hãy tạo sự kiện để bắt đầu lên kế hoạch, chia việc và theo dõi tiến độ đúng ngữ cảnh.": "! I’m the Multimedia team’s AI assistant. Create an event to start planning, assigning tasks, and tracking progress.",
        "Công việc hôm nay": "Today's tasks",
        "Xem các task cần hoàn thành.": "View tasks that need to be completed.",
        "Deadline sắp tới": "Upcoming deadlines",
        "Kiểm tra những deadline gần nhất.": "Check the nearest deadlines.",
        "Lập timeline sự kiện": "Plan event timeline",
        "AI gợi ý & tính toán đường găng CPM.": "AI suggestions and CPM critical-path calculation.",
        "AI hỗ trợ gợi ý. Bạn chủ động xem xét nội dung.": "AI suggestions are provided for assistance. Please review the content.",
        "Tạo sự kiện": "Create event",
        "Tên sự kiện": "Event name",
        "Mô tả sự kiện": "Event description",
        "Hủy": "Cancel",
        "Đính kèm tệp": "Attach a file",
        "Nhắn tin với trợ lý AI...": "Message the AI assistant...",
        "Nhập tin nhắn": "Enter a message",
        "Gửi tin nhắn": "Send message",
        "Đóng": "Close",
        "Ví dụ: Workshop mùa hè 2025": "e.g. Summer Workshop 2025",
        "Mô tả ngắn gọn về sự kiện...": "Briefly describe the event...",

        "Lịch sử sự kiện | AECPT": "Event history | AECPT",
        "Lịch sử sự kiện": "Event history",
        "Xem lại sự kiện và công việc từ dữ liệu ban Multimedia.": "Review events and tasks from the Multimedia team.",
        "Lọc theo năm": "Filter by year",
        "Tất cả năm": "All years",
        "Đang tải sự kiện...": "Loading events...",
        "Sắp xếp theo ngày kết thúc gần nhất": "Sorted by nearest end date",
        "Ngày bắt đầu": "Start date",
        "Ngày kết thúc": "End date",
        "Trạng thái": "Status",
        "Đang tải dữ liệu từ Supabase...": "Loading data from Supabase...",
        "Tìm kiếm tên sự kiện...": "Search event names...",
        "Danh sách sự kiện": "Event list",
        "Không thể tải dữ liệu": "Unable to load data",
        "Đã hoàn thành": "Completed",
        "Chưa hoàn thành": "Incomplete",
        "Đã hủy": "Cancelled",
        "Đang cập nhật": "Updating",
        "Không có sự kiện nào.": "There are no events.",
        "Không tìm thấy sự kiện phù hợp.": "No matching events found.",
        "Không tìm thấy sự kiện phù hợp với bộ lọc.": "No events match the current filters.",
        "Supabase hiện chưa có dữ liệu sự kiện.": "There is no event data in Supabase yet.",

        "Đăng nhập | AECPT": "Sign in | AECPT",
        "WORDSPACE FOR MULTIMEDIA": "WORKSPACE FOR MULTIMEDIA",
        "Quản lý công việc": "Manage work",
        "thông minh hơn": "smarter",
        "Trợ lý ảo đồng hành cùng ban Multimedia trong việc tổ chức, theo dõi và hoàn thành công việc.": "An AI assistant that helps the Multimedia team organize, track, and complete work.",
        "Kế hoạch sáng tạo": "Creative plan",
        "Lên ý tưởng nội dung": "Develop content ideas",
        "Nội dung • Đã hoàn thành": "Content • Completed",
        "Thiết kế ấn phẩm truyền thông": "Design promotional materials",
        "Thiết kế • Đang thực hiện": "Design • In progress",
        "Hoàn thiện video sự kiện": "Finish the event video",
        "Sản xuất • Hôm nay": "Production • Today",
        "Mỗi việc, một bước tiến": "Every task is a step forward",
        "Cùng nhau hoàn thành": "Achieve more together",
        "Chào mừng trở lại!": "Welcome back!",
        "Đăng nhập vào không gian làm việc của ban Multimedia": "Sign in to the Multimedia team workspace",
        "TẠO TÀI KHOẢN": "CREATE ACCOUNT",
        "Đăng ký tài khoản": "Create an account",
        "Tạo tài khoản để tham gia không gian làm việc của ban Multimedia.": "Create an account to join the Multimedia team workspace.",
        "Nhập email và mật khẩu nhé.": "Please enter your email and password.",
        "Đang đăng nhập...": "Signing in...",
        "Đang tạo tài khoản...": "Creating account...",
        "Vui lòng nhập họ và tên.": "Please enter your full name.",
        "Tạo tài khoản thành công. Tài khoản cần được trưởng nhóm liên kết với thành viên trước khi dùng workspace.": "Account created. A team leader must link it to a member before you can access the workspace.",
        "Đã tạo tài khoản. Hãy kiểm tra email để xác nhận, sau đó liên hệ trưởng nhóm để được liên kết với workspace.": "Account created. Check your email to confirm, then contact your team leader to be linked to the workspace.",
        "Vui lòng liên hệ quản trị viên của ban Multimedia để được hỗ trợ đặt lại mật khẩu.": "Contact the Multimedia team administrator for help resetting your password.",
        "Email công việc": "Work email",
        "Mật khẩu": "Password",
        "Hiện": "Show",
        "Ẩn": "Hide",
        "Ghi nhớ đăng nhập": "Remember me",
        "Quên mật khẩu?": "Forgot password?",
        "Đăng nhập": "Sign in",
        "Chưa có tài khoản?": "Don't have an account?",
        "Đăng ký": "Sign up",
        "Họ và tên": "Full name",
        "Tạo tài khoản": "Create account",
        "Tạo tài khoản chưa tự cấp quyền truy cập workspace. Trưởng nhóm cần liên kết tài khoản với thành viên trong hệ thống.": "Creating an account does not grant workspace access. A team leader must link the account to a team member.",
        "Đã có tài khoản?": "Already have an account?",
        "Đây là hệ thống nội bộ dành riêng cho thành viên ban Multimedia.": "This is an internal system for Multimedia team members only.",
        "Nhập email công việc": "Enter your work email",
        "Nhập mật khẩu": "Enter your password",
        "Nhập họ và tên": "Enter your full name",
        "Tối thiểu 8 ký tự": "At least 8 characters",

        "Thành viên | AECPT": "Members | AECPT",
        "Thành viên": "Members",
        "Quản lý và theo dõi thông tin các thành viên trong ban Multimedia.": "Manage and view information about Multimedia team members.",
        "Thêm thành viên": "Add member",
        "Tất cả thành viên": "All members",
        "Danh sách thành viên": "Member list",
        "Đang tải...": "Loading...",
        "Xóa bộ lọc": "Clear filters",
        "Nhóm chức năng": "Functional group",
        "Vai trò": "Role",
        "Email": "Email",
        "Thao tác": "Actions",
        "Chưa có thành viên": "No members yet",
        "Danh sách thành viên sẽ hiển thị tại đây khi có dữ liệu.": "The member list will appear here when data is available.",
        "Chưa có dữ liệu": "No data available",
        "Ban Multimedia": "Multimedia team",
        "Chi tiết thành viên": "Member details",
        "Thêm thành viên mới vào không gian ban Multimedia": "Add a new member to the Multimedia team workspace",
        "Mật khẩu khởi tạo": "Temporary password",
        "Mật khẩu phải có ít nhất 8 ký tự. Gửi cho thành viên qua kênh riêng.": "The password must be at least 8 characters. Share it with the member privately.",
        "Chọn vai trò": "Select a role",
        "Trưởng nhóm": "Team leader",
        "Trưởng nhóm, Thành viên": "Team leader, Member",
        "Cập nhật thông tin thành viên": "Update member information",
        "Cập nhật nhóm chức năng và thời gian rảnh của thành viên": "Update the member's functional groups and availability",
        "Họ và tên *": "Full name *",
        "Vui lòng nhập họ và tên": "Please enter a full name",
        "Chọn những nhóm chức năng mà thành viên tham gia": "Select the functional groups the member belongs to",
        "Chọn nhóm chức năng": "Select functional groups",
        "Thời gian rảnh": "Availability",
        "Chọn ngày và khung giờ thành viên có thể làm việc (từ 06:00 đến 22:00)": "Select the days and hours the member is available (06:00–22:00)",
        "Thứ 2": "Monday",
        "Thứ 3": "Tuesday",
        "Thứ 4": "Wednesday",
        "Thứ 5": "Thursday",
        "Thứ 6": "Friday",
        "Thứ 7": "Saturday",
        "Chủ nhật": "Sunday",
        "Chọn một thứ ở trên để thiết lập khung giờ rảnh.": "Select a day above to set available hours.",
        "Lưu thời gian rảnh": "Save availability",
        "Lưu thành viên": "Save member",
        "Tìm kiếm thành viên...": "Search members...",
        "Nhập địa chỉ email": "Enter an email address",
        "Nhập mật khẩu ban đầu": "Enter a temporary password",
        "Hiện mật khẩu": "Show password",
        "Đóng cửa sổ": "Close dialog",
        "Nhập tên thành viên": "Enter a member name",

        "Công việc của tôi | AECPT": "My tasks | AECPT",
        "Công việc của tôi": "My tasks",
        "Theo dõi công việc được giao và cập nhật trạng thái.": "Track assigned tasks and update their status.",
        "Lọc": "Filter",
        "Tất cả nhóm": "All groups",
        "Đặt lại bộ lọc": "Reset filters",
        "Tổng công việc": "Total tasks",
        "Chưa bắt đầu": "Not started",
        "Đang thực hiện": "In progress",
        "Tất cả": "All",
        "Chờ duyệt": "Pending review",
        "Tên công việc": "Task name",
        "Nhóm": "Group",
        "Người giao": "Assigned by",
        "Deadline": "Deadline",
        "Mức độ ưu tiên": "Priority",
        "Đang tải danh sách công việc...": "Loading task list...",
        "Đang tải dữ liệu...": "Loading data...",
        "Tiến độ của tôi": "My progress",
        "Tiến độ sẽ được cập nhật khi có dữ liệu công việc.": "Progress will be updated when task data is available.",
        "Chi tiết công việc": "Task details",
        "Thông tin và trạng thái công việc được giao": "Assigned task information and status",
        "Bắt đầu công việc": "Start task",
        "Cập nhật trạng thái": "Update status",
        "Đánh dấu hoàn thành": "Mark as complete",
        "Cập nhật trạng thái công việc được giao cho bạn.": "Update the status of a task assigned to you.",
        "Công việc được giao": "Assigned task",
        "Chỉ trạng thái được lưu trong dữ liệu hiện tại; ghi chú, tệp đính kèm và phần trăm tiến độ chưa có trong database.": "Only the status is currently stored; notes, attachments, and progress percentage are not available in the database.",
        "Lưu cập nhật": "Save changes",
        "Vai trò": "Role",
        "Tìm kiếm công việc...": "Search tasks...",
        "Thống kê công việc": "Task statistics",
        "Lọc theo trạng thái": "Filter by status",
        "Trang trước": "Previous page",
        "Trang sau": "Next page",
        "Đóng popup": "Close dialog",
        "Không tìm thấy công việc phù hợp.": "No matching tasks found.",
        "Chọn ngày để xem lịch trong ngày hoặc chọn công việc để xem chi tiết.": "Select a date to view its schedule or choose a task to see its details.",
        "Chọn ngày bất kỳ để xem lịch trong ngày. Tháng này chưa có deadline.": "Select a date to view its schedule. There are no deadlines this month.",
        "Deadline được hiển thị theo ngày, không gán giờ nếu dữ liệu không có.": "Deadlines are shown by day; times are not assumed when they are not in the data.",
        "Không có deadline trong tuần này.": "No deadlines this week.",
        "Không có deadline nào trong ngày này.": "No deadlines on this day.",
        "Không có deadline trong tháng này.": "No deadlines this month.",
        "Chọn ngày đã chọn": "Select date",
        "Ngày đã chọn": "Selected day",
        "Mở công việc cá nhân để xem đầy đủ nội dung.": "Open My Tasks to view the full details.",
        "Không có mô tả.": "No description.",
        "Chưa đủ dữ liệu": "Not enough data",
        "Chưa có vai trò": "No role assigned",
        "Chưa có dữ liệu công việc.": "No task data available.",
        "Chưa có dữ liệu": "No data available",
        "Chưa cập nhật": "Not updated",
        "Chưa phân nhóm": "No group assigned",
        "Chưa đăng": "Not published",
        "Đã đăng": "Published",
        "Chưa rõ": "Unknown",
        "Đã đăng bài": "Published",
        "Đường găng": "Critical path",
        "Dự phòng:": "Backup:",
        "Không tìm thấy thành viên cần cập nhật.": "Could not find the member to update.",
        "Không xác định được thành viên hoặc công việc.": "Could not identify the member or task.",
        "Không xác định được thành viên đang đăng nhập.": "Could not identify the signed-in member.",
        "Bạn không được phân công vào công việc này.": "You are not assigned to this task.",
        "Không có phân công nào được cập nhật. Kiểm tra quyền truy cập.": "No assignments were updated. Check access permissions.",
        "Không thể tải dữ liệu": "Unable to load data",
        "Không thể tải dữ liệu từ Supabase.": "Unable to load data from Supabase.",
        "Không kết nối được Supabase. Hãy tải lại trang.": "Could not connect to Supabase. Please reload the page.",
        "Vui lòng nhập tên hiển thị.": "Please enter a display name.",
        "Mật khẩu cần có ít nhất 8 ký tự.": "The password must be at least 8 characters.",
        "Hai mật khẩu chưa khớp.": "The passwords do not match.",
        "Đã cập nhật tên hiển thị.": "Display name updated.",
        "Đã cập nhật mật khẩu.": "Password updated.",
        "Đang xóa...": "Deleting...",
        "Lưu thời gian rảnh": "Save availability",
        "Vui lòng thử tải lại trang": "Please try reloading the page.",
        "Không có sự kiện đang diễn ra.": "There is no active event.",
        "Không thể tải dữ liệu công việc...": "Unable to load task data...",
        "Tài khoản chưa được liên kết với thành viên. Hãy thêm liên kết trong bảng team_members.": "This account is not linked to a member. Add a link in the team_members table.",
        "Không thể tải thông tin sự kiện.": "Unable to load event information.",
        "Không thể tải dữ liệu lịch sử:": "Unable to load event history:",
        "Tệp đính kèm": "Attachments",
        "Tải lên": "Upload",
        "Đã lưu link bài làm.": "Submission link saved.",
        "Link bài làm đã được lưu.": "Submission link saved.",
        "Xóa link bài làm": "Delete submission link",
        "Lưu tiến độ": "Save progress",
        "Đang lưu...": "Saving...",
        "Đang cập nhật...": "Updating...",
        "Không thể tải thông tin công việc...": "Unable to load task information...",
        "Không tìm thấy công việc.": "Task not found.",
        "Không thể tải dữ liệu sự kiện.": "Unable to load event data.",
        "Không có thành viên nào.": "There are no members.",
        "Đã lưu thời gian rảnh.": "Availability saved.",
        "Không thể thêm thành viên. Vui lòng thử lại.": "Unable to add member. Please try again.",
        "Không thể cập nhật thông tin. Vui lòng thử lại.": "Unable to update information. Please try again.",
        "Không thể tải chi tiết thành viên.": "Unable to load member details.",
        "Lỗi Supabase": "Supabase error",
        "Đang tải thông tin công việc...": "Loading task information...",
        "Thông tin thành viên": "Member information",
        "Thứ": "Day",
        "Tất cả năm": "All years",
        "Đang tải dữ liệu...": "Loading data...",
        "Tìm kiếm công việc...": "Search tasks...",
        "Trang tiếp theo": "Next page",
        "Tháng": "Month",
        "Tất cả trạng thái": "All statuses",
        "Deadline gần nhất": "Nearest deadline",
        "Deadline xa nhất": "Farthest deadline",
        "Ngày lên sóng mới nhất": "Latest on-air date",
        "Nhóm phụ trách": "Responsible group",
        "Thành viên phụ trách": "Assigned member",
        "Tất cả thành viên": "All members",
        "Sự kiện / Loại": "Event / Type",
        "Người thực hiện": "Assignee",
        "Ngày lên sóng": "On-air date",
        "Deadline gói": "Package deadline",
        "Tình trạng đăng": "Publishing status",
        "Bạn có thể xem công việc toàn ban và chỉ cập nhật trạng thái đối với công việc của mình.": "You can view all team tasks and update the status of tasks assigned to you.",
        "Xem chi tiết": "View details",
        "Database hiện chỉ lưu trạng thái; phần trăm tiến độ, ghi chú và tệp đính kèm chưa được hỗ trợ.": "The database currently stores only task status; progress, notes, and attachments are not supported.",

        "Lịch & Deadline | AECPT": "Calendar & Deadlines | AECPT",
        "Lịch & Deadline": "Calendar & Deadlines",
        "Theo dõi lịch làm việc và những deadline sắp tới của bạn.": "Track your work schedule and upcoming deadlines.",
        "Hôm nay": "Today",
        "Deadline hôm nay": "Due today",
        "Trong 7 ngày tới": "Next 7 days",
        "Đã quá hạn": "Overdue",
        "Lịch tháng": "Month",
        "Lịch tuần": "Week",
        "Gantt Chart": "Gantt chart",
        "Chỉ công việc của tôi": "My tasks only",
        "Theo dõi thời gian thực hiện và tiến độ công việc của bạn.": "Track task schedules and progress.",
        "Ngày": "Day",
        "Tuần": "Week",
        "Tháng": "Month",
        "Công việc": "Task",
        "Deadline được hiển thị theo ngày.": "Deadlines are shown by day.",
        "Các công việc cần chú ý.": "Tasks that need attention.",
        "Mô tả công việc": "Task description",
        "Mã công việc": "Task ID",
        "Sự kiện": "Event",
        "Loại công việc": "Task type",
        "Mức ưu tiên": "Priority",
        "Người thực hiện": "Assignee",
        "Bắt đầu": "Start",
        "Lên sóng": "On air",
        "Thời lượng": "Duration",
        "Tiến độ công việc": "Task progress",
        "Ghi chú sự kiện": "Event notes",
        "Thông tin nhóm và lịch thực hiện là thông tin được giao cho bạn.": "Group and schedule details are assigned to you.",
        "Xem chi tiết công việc": "View task details",
        "Chọn ngày trong lịch": "Choose a calendar date",
        "Chọn ngày cần xem": "Choose a date to view",
        "Thời gian trước": "Previous period",
        "Thời gian tiếp theo": "Next period",
        "Chọn tháng cho Gantt Chart": "Choose a month for the Gantt chart",
        "Đóng chi tiết": "Close details",
        "Deadline sắp tới": "Upcoming deadlines",
        "Tháng": "Month",

        "Cài đặt | AECPT": "Settings | AECPT",
        "Cài đặt": "Settings",
        "Quản lý thông tin tài khoản và bảo mật của bạn.": "Manage your account information and security.",
        "Cài đặt thông báo": "Notification settings",
        "Tùy chỉnh thông báo và nhắc hạn cho tài khoản của bạn.": "Customize notifications and deadline reminders for your account.",
        "Đang tải tài khoản…": "Loading account…",
        "Đang tải vai trò…": "Loading role…",
        "Thông báo": "Notifications",
        "Công việc mới": "New tasks",
        "Khi bạn được giao công việc.": "When a task is assigned to you.",
        "Bật": "On",
        "Nhắc deadline": "Deadline reminders",
        "Nhận nhắc nhở trước khi công việc đến hạn.": "Get reminders before a task is due.",
        "Nhắc trước": "Remind me",
        "1 giờ": "1 hour",
        "3 giờ": "3 hours",
        "6 giờ": "6 hours",
        "12 giờ": "12 hours",
        "24 giờ": "24 hours",
        "48 giờ": "48 hours",
        "Giờ nhận nhắc nhở": "Reminder time",
        "Giờ Việt Nam (GMT+7)": "Vietnam time (GMT+7)",
        "Mỗi ngày lúc 08:00, nhắc công việc đến hạn trong 24 giờ tới.": "Every day at 08:00, remind me about tasks due within the next 24 hours.",
        "Công việc quá hạn": "Overdue tasks",
        "Nhắc các công việc chưa hoàn thành đã trễ deadline.": "Remind me about incomplete tasks past their deadlines.",
        "Ngôn ngữ": "Language",
        "Tiếng Việt": "Vietnamese",
        "Các tùy chọn này chỉ áp dụng cho tài khoản của bạn.": "These preferences apply only to your account.",
        "Lưu thay đổi": "Save changes",
        "Thông tin tài khoản": "Account information",
        "Tên hiển thị được lưu trong hồ sơ Supabase Auth của bạn.": "Your display name is saved in your Supabase Auth profile.",
        "Tên hiển thị": "Display name",
        "Email đăng nhập": "Login email",
        "Email hiện chỉ hiển thị; hãy liên hệ quản trị viên nếu cần đổi email.": "Email is read-only. Contact an administrator if it needs to be changed.",
        "Đổi mật khẩu": "Change password",
        "Dùng mật khẩu mới để đăng nhập trong những lần sau.": "Use your new password the next time you sign in.",
        "Mật khẩu hiện tại": "Current password",
        "Nhập mật khẩu hiện tại": "Enter your current password",
        "Vui lòng nhập mật khẩu hiện tại.": "Please enter your current password.",
        "Mật khẩu hiện tại không đúng.": "The current password is incorrect.",
        "Mật khẩu mới": "New password",
        "Nhập lại mật khẩu mới": "Confirm new password",
        "Cập nhật mật khẩu": "Update password",
        "Phiên đăng nhập": "Session",
        "Đăng xuất tài khoản này khỏi thiết bị hiện tại.": "Sign this account out from the current device.",
        "Đăng xuất": "Sign out",
        "Hủy thay đổi": "Discard changes",
        "Nhập tên của bạn": "Enter your name",
        "Ít nhất 8 ký tự": "At least 8 characters",
        "Nhập lại mật khẩu": "Re-enter your password",

        "Workspace for Multimedia": "Workspace for Multimedia",
        "KHÔNG GIAN MULTIMEDIA": "MULTIMEDIA WORKSPACE",
        "Danh sách công việc": "Task list",
        "Danh sách công việc | AECPT": "Task list | AECPT",
        "Theo dõi các công việc đang được triển khai trong ban Multimedia.": "Track tasks currently underway in the Multimedia team.",
        "Bộ lọc": "Filters",
        "Tổng quan ban Multimedia · Tất cả nhóm": "Multimedia team overview · All groups",
        "Tất cả nhóm": "All groups",
        "Danh sách công việc sẽ hiển thị tại đây khi có dữ liệu.": "Tasks will appear here when data is available.",
        "LỊCH SỬ TRÒ CHUYỆN": "CHAT HISTORY",
        "Không thể tải thanh điều hướng.": "Unable to load the navigation menu.",
        "Chưa phân loại": "Uncategorized",
        "Chưa có hạn chót": "No deadline",
        "Chưa phân công": "Unassigned",
        "Chưa gán vai trò": "No role assigned",
        "Không tải được vai trò": "Could not load role",
        "Không hoạt động": "Inactive",
        "Đang hoạt động": "Active",
        "Đang chờ": "Pending",
        "Chưa đăng": "Not published",
        "Chưa rõ trạng thái": "Unknown status",
        "Không có ghi chú mô tả sự kiện.": "No event description is available.",
        "Đã lưu thành công!": "Saved successfully!",
        "Đang lưu…": "Saving…",
        "Đang cập nhật…": "Updating…",
        "Thử lưu lại": "Try saving again",
        "Lưu link": "Save link",
        "Link này đã được lưu cho công việc.": "This link has been saved for the task.",
        "Đã lưu link vào tệp đính kèm của công việc.": "The link has been saved to the task attachments.",
        "Đã xóa link bài làm.": "Submission link deleted.",
        "Link bài làm": "Submission link",
        "Tổng quan": "Overview",
        "Sắp đến hạn": "Due soon",
        "Ưu tiên cao": "High priority",
        "Bình thường": "Normal",
        "Thấp": "Low",
        "Cao": "High",
        "Trung bình": "Medium",
        "Đang tải dữ liệu công việc...": "Loading task data...",
        "Không thể tải dữ liệu lịch sử:": "Unable to load event history:"
    };

    const textSources = new WeakMap();
    const attributeSources = new WeakMap();
    let language = localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "vi";

    function normalize(value) {
        return value.replace(/\s+/g, " ").trim();
    }

    function translate(value) {
        const key = normalize(value);
        if (language === "vi") return value;
        if (translations[key]) return translations[key];

        let match = key.match(/^(\d+) sự kiện$/);
        if (match) return `${match[1]} events`;
        match = key.match(/^(\d+) công việc$/);
        if (match) return `${match[1]} ${Number(match[1]) === 1 ? "task" : "tasks"}`;
        match = key.match(/^\+(\d+) công việc$/);
        if (match) return `+${match[1]} ${Number(match[1]) === 1 ? "task" : "tasks"}`;
        match = key.match(/^(\d+) deadline trong (tháng|tuần|ngày)$/);
        if (match) return `${match[1]} ${Number(match[1]) === 1 ? "deadline" : "deadlines"} this ${match[2] === "tháng" ? "month" : match[2] === "tuần" ? "week" : "day"}`;
        match = key.match(/^(\d+) deadline trong ngày đã chọn$/);
        if (match) return `${match[1]} ${Number(match[1]) === 1 ? "deadline" : "deadlines"} on the selected day`;
        match = key.match(/^(\d+) thành viên$/);
        if (match) return `${match[1]} ${Number(match[1]) === 1 ? "member" : "members"}`;
        match = key.match(/^Hiển thị (\d+) trong (\d+) thành viên$/);
        if (match) return `Showing ${match[1]} of ${match[2]} members`;
        match = key.match(/^Hiển thị (\d+)\/(\d+) công việc$/);
        if (match) return `Showing ${match[1]}/${match[2]} tasks`;
        match = key.match(/^Dư (\d+)h$/);
        if (match) return `${match[1]}h slack`;
        match = key.match(/^\(Dự phòng:\s*(.+)\)$/);
        if (match) return `(Backup: ${match[1]})`;
        match = key.match(/^(\d+) deadline trong (.+) · Hiển thị ngày bắt đầu và tiến độ từ database$/);
        if (match) return `${match[1]} deadlines in ${match[2]} · showing start dates and progress from the database`;
        match = key.match(/^Trạng thái:\s*(.+)$/);
        if (match) return `Status: ${translations[match[1]] || match[1]}`;
        match = key.match(/^Người phụ trách:\s*(.+)$/);
        if (match) return `Assignee: ${match[1]}`;
        match = key.match(/^Không thể tải dữ liệu lịch sử:\s*(.*)$/);
        if (match) return `Unable to load event history: ${match[1]}`;
        match = key.match(/^Không thể tạo sự kiện:\s*(.*)$/);
        if (match) return `Unable to create event: ${match[1]}`;
        match = key.match(/^Không thể hoàn tất sự kiện:\s*(.*)$/);
        if (match) return `Unable to complete event: ${match[1]}`;
        match = key.match(/^Không thể cập nhật trạng thái:\s*(.*)$/);
        if (match) return `Unable to update status: ${match[1]}`;
        match = key.match(/^Đã lưu vào sự kiện (.+) với (\d+) công việc\.$/);
        if (match) return `Saved to event ${match[1]} with ${match[2]} ${Number(match[2]) === 1 ? "task" : "tasks"}.`;
        match = key.match(/^Xóa link "(.+)"\?$/);
        if (match) return `Delete link "${match[1]}"?`;
        match = key.match(/^Mỗi ngày lúc (.+), nhắc công việc đến hạn trong (.+)\.$/);
        if (match) return `Every day at ${match[1]}, remind me about tasks due within the next ${match[2]}.`;
        return value;
    }

    function translateTextNode(node) {
        if (!textSources.has(node)) textSources.set(node, node.nodeValue);
        const source = textSources.get(node);
        const leading = source.match(/^\s*/)?.[0] || "";
        const trailing = source.match(/\s*$/)?.[0] || "";
        const content = source.trim();
        if (!content) return;
        const roleElement = node.parentElement?.closest("#userRole, #notificationAccountRole");
        const translated = language === "en" && content === "Thành viên" && roleElement
            ? "Member"
            : translate(content);
        const nextValue = `${leading}${translated}${trailing}`;
        if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
    }

    function translateElementAttributes(element) {
        ["placeholder", "title", "aria-label", "alt"].forEach(attribute => {
            if (!element.hasAttribute(attribute)) return;
            let sources = attributeSources.get(element);
            if (!sources) {
                sources = {};
                attributeSources.set(element, sources);
            }
            if (!(attribute in sources)) sources[attribute] = element.getAttribute(attribute);
            const source = sources[attribute];
            const translated = translate(source);
            if (element.getAttribute(attribute) !== translated) {
                element.setAttribute(attribute, translated);
            }
        });
    }

    function translateTree(root) {
        if (!(root instanceof Element) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(root.tagName)) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (!/^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.parentElement?.tagName || "")) {
                translateTextNode(node);
            }
        }

        translateElementAttributes(root);
        root.querySelectorAll("*").forEach(translateElementAttributes);
    }

    function applyLanguage(nextLanguage) {
        language = nextLanguage === "en" ? "en" : "vi";
        localStorage.setItem(STORAGE_KEY, language);
        document.documentElement.lang = language;

        if (document.head) translateTree(document.head);
        if (document.body) translateTree(document.body);

        const select = document.getElementById("settingsLanguage");
        if (select) select.value = language;
    }

    window.AppI18n = {
        get language() {
            return language;
        },
        get locale() {
            return language === "en" ? "en-US" : "vi-VN";
        },
        setLanguage: applyLanguage,
        translate
    };

    function bindLanguageSelect() {
        const languageSelect = document.getElementById("settingsLanguage");
        if (!languageSelect || languageSelect.dataset.languageBound) return;
        languageSelect.dataset.languageBound = "true";
        languageSelect.value = language;
        languageSelect.addEventListener("change", () => applyLanguage(languageSelect.value));
    }

    applyLanguage(language);
    document.addEventListener("DOMContentLoaded", () => {
        bindLanguageSelect();
        applyLanguage(language);
    });

    const observer = new MutationObserver(records => {
        records.forEach(record => {
            if (record.type === "characterData") {
                translateTextNode(record.target);
                return;
            }
            record.addedNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
                else if (node.nodeType === Node.ELEMENT_NODE) translateTree(node);
            });
        });
    });

    if (document.documentElement) {
        observer.observe(document.documentElement, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    window.addEventListener("storage", event => {
        if (event.key === STORAGE_KEY) applyLanguage(event.newValue);
    });
})();
