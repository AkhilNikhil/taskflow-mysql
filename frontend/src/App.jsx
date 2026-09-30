import { useEffect, useState, useCallback, useRef } from "react";
import { authClient } from "./authClient";
import { apiRequest, BASE_API_URL, DIRECT_BACKEND_URL } from "./api";
import "./App.css";
import TaskEditModal from "./components/TaskEditModal";
import ProfileModal from "./components/ProfileModal";

export default function App() {
  // Auth state
  const [session, setSession] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // App & Dashboard state
  const [backendStatus, setBackendStatus] = useState("checking");
  const [tasks, setTasks] = useState([]);
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [activeTab, setActiveTab] = useState("my"); // "my", "teams", "org"
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilterTeamId, setSelectedFilterTeamId] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // "all", "pending", "completed"
  const [appMessage, setAppMessage] = useState("");

  // Create Task state
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [taskTeamId, setTaskTeamId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [workspaceUsers, setWorkspaceUsers] = useState([]);
  const [selectedUserOverviewId, setSelectedUserOverviewId] = useState(null);
  const [userOverviewSearch, setUserOverviewSearch] = useState("");
  const [userOverviewStatusFilter, setUserOverviewStatusFilter] = useState("all");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkLines, setBulkLines] = useState("");
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  // Create Team modal state
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDesc, setNewTeamDesc] = useState("");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState(null);
  const [isLoadingTeamDetail, setIsLoadingTeamDetail] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("MEMBER");
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Admin Panel state (Architect only)
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [isLoadingAdminUsers, setIsLoadingAdminUsers] = useState(false);
  const [isUpdatingUserRole, setIsUpdatingUserRole] = useState(false);

  // --- UI state (dark mode, mobile menu, task/team editing) ---
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") ||
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  const [editingTeam, setEditingTeam] = useState(false);
  const [editTeamName, setEditTeamName] = useState("");
  const [editTeamDesc, setEditTeamDesc] = useState("");
  const [syncRetry, setSyncRetry] = useState(0);
  const [taskDueDate, setTaskDueDate] = useState("");
  const [editingTaskItem, setEditingTaskItem] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // --- refs ---
  const backendStatusRef = useRef("checking");
  const healthTimer = useRef(null);
  const syncingRef = useRef(false);
  const syncFailures = useRef(0);
  const wakeStartRef = useRef(Date.now());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const onBlocked = async (e) => {
      try {
        await authClient.auth.signOut();
      } catch (err) {
        console.warn("SignOut error:", err);
      } finally {
        setSession(null);
        setUserProfile(null);
        setTasks([]);
        setTeams([]);
        setAuthPassword("");
        setAuthConfirmPassword("");
      }
      setAuthMessage(`⛔ ${e.detail}. Please contact your administrator.`);
    };
    window.addEventListener("account-blocked", onBlocked);
    return () => window.removeEventListener("account-blocked", onBlocked);
  }, []);

  // ----------------------------------------------------
  // 1. BACKEND HEALTH CHECK & SMART WAKE-UP
  // ----------------------------------------------------
  const [wakeUpSeconds, setWakeUpSeconds] = useState(0);

  const setStatus = useCallback((s) => {
    backendStatusRef.current = s;
    setBackendStatus(s);
  }, []);

  const probe = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const wakeBackend = useCallback(() => {
    if (!DIRECT_BACKEND_URL) return;
    // Equivalent to opening the backend link: Render holds this request while the app boots.
    fetch(`${DIRECT_BACKEND_URL}/api/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
  }, []);

  const checkHealth = useCallback(async (retryCount = 0) => {
    clearTimeout(healthTimer.current);
    if (retryCount === 0) wakeStartRef.current = Date.now();
    if (retryCount === 0 && backendStatusRef.current !== "connected") {
      setStatus("checking");
      setWakeUpSeconds(0);
      wakeBackend();                       // kick the sleeping backend right away
    }

    let ok = await probe(`${BASE_API_URL}/api/health`);
    if (!ok && DIRECT_BACKEND_URL) ok = await probe(`${DIRECT_BACKEND_URL}/api/health`);

    if (ok) {
      setStatus("connected");
      setWakeUpSeconds(0);
      return true;
    }

    const elapsed = Date.now() - wakeStartRef.current;
    if (elapsed < 240000) {                // keep trying for up to 4 minutes
      setStatus("waking up");
      setWakeUpSeconds(Math.round(elapsed / 1000));
      if (retryCount > 0 && retryCount % 4 === 0) wakeBackend();
      healthTimer.current = setTimeout(() => checkHealth(retryCount + 1), 3000);
    } else {
      setStatus("offline");
    }
    return false;
  }, [setStatus, wakeBackend]);

  const getStatusLabel = () => {
    if (backendStatus === "connected") return "Online";
    if (backendStatus === "waking up" || backendStatus === "retrying") {
      return `Waking up backend (${wakeUpSeconds}s — can take up to 2 min)...`;
    }
    if (backendStatus === "checking") return "Connecting...";
    return "Offline";
  };

  useEffect(() => {
    checkHealth(0);
    const interval = setInterval(() => {
      if (backendStatusRef.current === "connected") checkHealth(0);
    }, 60000);
    return () => {
      clearInterval(interval);
      clearTimeout(healthTimer.current);
    };
  }, [checkHealth]);

  // Once the backend is up and we have a session but no profile yet, sync it
  useEffect(() => {
    if (backendStatus === "connected" && session && !userProfile) {
      syncProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendStatus, session?.user?.id, userProfile, syncRetry]);

  // ----------------------------------------------------
  // 2. AUTH SESSION MANAGEMENT
  // ----------------------------------------------------
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const queryParams = new URLSearchParams(window.location.search);
    const errorDesc = hashParams.get("error_description") || queryParams.get("error_description");
    if (errorDesc) {
      setAuthMessage("Auth Error: " + decodeURIComponent(errorDesc.replace(/\+/g, " ")));
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    authClient.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthChecking(false);
    });

    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
      setSession(session);            // NO async work in here
      if (!session) {
        syncFailures.current = 0;
        setUserProfile(null);
        setTasks([]);
        setTeams([]);
        setAuthPassword("");
        setAuthConfirmPassword("");
      } else if (window.location.hash || window.location.search.includes("code=")) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      setIsAuthChecking(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const syncProfile = async () => {
    if (syncingRef.current) return;           // never run two syncs in parallel
    syncingRef.current = true;
    try {
      await apiRequest("/api/auth/sync", { method: "POST", body: JSON.stringify({}) });
      const meData = await apiRequest("/api/auth/me");
      setUserProfile(meData.user);
      setAppMessage(null);
      syncFailures.current = 0;
      loadTasks();
      loadTeams();
      loadWorkspaceUsers();
    } catch (err) {
      console.error("Profile sync failed:", err);
      if (backendStatusRef.current === "connected") {
        setAppMessage("Profile sync notice: " + (err.message || "Failed to sync"));
      }
      if (syncFailures.current < 5) {        // retry a few times, then stop
        syncFailures.current += 1;
        setTimeout(() => setSyncRetry((n) => n + 1), 5000);
      }
    } finally {
      syncingRef.current = false;
    }
  };

  const loadWorkspaceUsers = async () => {
    try {
      const data = await apiRequest("/api/auth/users");
      setWorkspaceUsers(data.users || []);
    } catch (err) {
      console.error("Failed to load workspace users:", err);
    }
  };

  // ----------------------------------------------------
  // 3. DATA LOADING (TASKS & TEAMS)
  // ----------------------------------------------------
  const loadTasks = async () => {
    setIsLoadingTasks(true);
    try {
      const data = await apiRequest("/api/tasks");
      setTasks(data.tasks || []);
    } catch (err) {
      setAppMessage(err.message || "Failed to load tasks");
    } finally {
      setIsLoadingTasks(false);
    }
  };

  const loadTeams = async () => {
    try {
      const data = await apiRequest("/api/teams");
      setTeams(data.teams || []);
    } catch (err) {
      console.error("Failed to load teams:", err);
    }
  };

  // ----------------------------------------------------
  // 4. AUTH ACTIONS (LOGIN, SIGN UP, LOGOUT)
  // ----------------------------------------------------
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");

    try {
      if (!isLoginMode && authPassword !== authConfirmPassword) {
        throw new Error("Passwords do not match.");
      }

      if (isLoginMode) {
        const { error } = await authClient.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) {
          const lowerMsg = (error.message || "").toLowerCase();
          if (lowerMsg.includes("banned")) {
            throw new Error("⛔ Your account has been suspended. Please contact your administrator.");
          }
          throw error;
        }
        setAuthPassword("");
        setAuthConfirmPassword("");
      } else {
        const { error } = await authClient.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: { display_name: authDisplayName.trim() },
          },
        });
        if (error) throw error;
        setAuthPassword("");
        setAuthConfirmPassword("");
      }
    } catch (err) {
      setAuthMessage(err.message || "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  };



  const handleLogout = async () => {
    try {
      await authClient.auth.signOut();
    } catch (err) {
      console.warn("SignOut error:", err);
    } finally {
      setSession(null);
      setUserProfile(null);
      setTasks([]);
      setTeams([]);
      setAuthPassword("");
      setAuthConfirmPassword("");
      try {
        const legacyKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("sb-") || k.includes("supabase"))) legacyKeys.push(k);
        }
        legacyKeys.forEach((k) => localStorage.removeItem(k));
        const sKeys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && (k.startsWith("sb-") || k.includes("supabase"))) sKeys.push(k);
        }
        sKeys.forEach((k) => sessionStorage.removeItem(k));
      } catch {
        /* ignore */
      }
    }
  };

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // ----------------------------------------------------
  // 5. TASK ACTIONS
  // ----------------------------------------------------
  const handleCreateTask = async (e) => {
    e.preventDefault();
    setIsCreatingTask(true);
    setAppMessage("");

    try {
      if (isBulkMode) {
        // Bulk creation (split lines, up to 10)
        const lines = bulkLines
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

        if (lines.length === 0) {
          throw new Error("Enter at least one task title for bulk creation");
        }
        if (lines.length > 10) {
          throw new Error("Bulk creation is capped at a maximum of 10 tasks per request");
        }

        const bulkPayload = lines.map((title) => ({
          title,
          priority: taskPriority,
          assigned_team_id: taskTeamId || null,
          assigned_user_id: taskAssigneeId || null,
        }));

        await apiRequest("/api/tasks", {
          method: "POST",
          body: JSON.stringify(bulkPayload),
        });

        setBulkLines("");
        setIsBulkMode(false);
        setAppMessage(`Successfully created ${lines.length} tasks!`);
      } else {
        if (!taskTitle.trim()) {
          throw new Error("Task title is required");
        }

        await apiRequest("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: taskTitle.trim(),
            description: taskDesc.trim() || null,
            due_date: taskDueDate || null,
            priority: taskPriority,
            assigned_team_id: taskTeamId || null,
            assigned_user_id: taskAssigneeId || null,
          }),
        });

        setTaskTitle("");
        setTaskDesc("");
        setTaskDueDate("");
        setAppMessage("Task created successfully!");
      }

      setTaskTeamId("");
      setTaskAssigneeId("");
      await loadTasks();
    } catch (err) {
      setAppMessage(err.message || "Failed to create task");
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleToggleComplete = async (task) => {
    const nextStatus = task.status === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED";
    try {
      await apiRequest(`/api/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      loadTasks();
    } catch (err) {
      setAppMessage(err.message || "Failed to update task");
    }
  };

  const handleClaimTask = async (task) => {
    try {
      await apiRequest(`/api/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ claim: true }),
      });
      setAppMessage(`Claimed task "${task.title}"!`);
      loadTasks();
    } catch (err) {
      setAppMessage(err.message || "Failed to claim task");
    }
  };

  const handleDeleteTask = async (task) => {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    try {
      await apiRequest(`/api/tasks/${task.id}`, { method: "DELETE" });
      setAppMessage("Task deleted");
      loadTasks();
    } catch (err) {
      setAppMessage(err.message || "Failed to delete task");
    }
  };

  const handleChangeStatus = async (task, status) => {
    try {
      await apiRequest(`/api/tasks/${task.id}`, { method: "PUT", body: JSON.stringify({ status }) });
      loadTasks();
    } catch (err) {
      setAppMessage(err.message || "Failed to update status");
    }
  };

  const handleSaveTaskEdit = async (taskId, fields) => {
    await apiRequest(`/api/tasks/${taskId}`, { method: "PUT", body: JSON.stringify(fields) });
    setEditingTaskItem(null);
    setAppMessage("Task updated");
    await loadTasks();
  };

  // ----------------------------------------------------
  // 6. TEAM ACTIONS
  // ----------------------------------------------------
  const handleSelectTeam = async (team) => {
    setEditingTeam(false);
    setIsLoadingTeamDetail(true);
    try {
      const data = await apiRequest(`/api/teams/${team.id}`);
      setSelectedTeamDetail(data.team);
    } catch (err) {
      setAppMessage(err.message || "Failed to load team details");
    } finally {
      setIsLoadingTeamDetail(false);
    }
  };

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    setIsCreatingTeam(true);
    try {
      const res = await apiRequest("/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: newTeamName.trim(),
          description: newTeamDesc.trim() || null,
        }),
      });
      setNewTeamName("");
      setNewTeamDesc("");
      setAppMessage("Team created successfully! You can now invite teammates below.");
      await loadTeams();
      if (res.team) {
        handleSelectTeam(res.team);
      }
    } catch (err) {
      setAppMessage(err.message || "Failed to create team");
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!selectedTeamDetail || !newMemberEmail.trim()) return;

    setIsAddingMember(true);
    try {
      const res = await apiRequest(`/api/teams/${selectedTeamDetail.id}/members`, {
        method: "POST",
        body: JSON.stringify({
          email: newMemberEmail.trim(),
          team_role: newMemberRole,
        }),
      });
      setAppMessage(res.message || "Member added successfully");
      setNewMemberEmail("");
      const refreshed = await apiRequest(`/api/teams/${selectedTeamDetail.id}`);
      setSelectedTeamDetail(refreshed.team);
      loadTeams();
    } catch (err) {
      setAppMessage(err.message || "Failed to add member. Note: The teammate must register their account first.");
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (memberUserId, memberName) => {
    if (!selectedTeamDetail) return;
    if (!window.confirm(`Remove ${memberName || "this user"} from ${selectedTeamDetail.name}?`)) return;

    try {
      await apiRequest(`/api/teams/${selectedTeamDetail.id}/members/${memberUserId}`, {
        method: "DELETE",
      });
      setAppMessage("Member removed from team");
      const refreshed = await apiRequest(`/api/teams/${selectedTeamDetail.id}`);
      setSelectedTeamDetail(refreshed.team);
      loadTeams();
    } catch (err) {
      setAppMessage(err.message || "Failed to remove member");
    }
  };

  const refreshSelectedTeam = async () => {
    const refreshed = await apiRequest(`/api/teams/${selectedTeamDetail.id}`);
    setSelectedTeamDetail(refreshed.team);
    loadTeams();
  };

  const handleSaveTeamEdit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/api/teams/${selectedTeamDetail.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: editTeamName.trim(), description: editTeamDesc.trim() }),
      });
      setEditingTeam(false);
      setAppMessage("Team updated");
      await refreshSelectedTeam();
    } catch (err) {
      setAppMessage(err.message || "Failed to update team");
    }
  };

  const handleDeleteTeam = async () => {
    if (!window.confirm(`Delete team "${selectedTeamDetail.name}"?\nIts tasks will become personal tasks.`)) return;
    try {
      await apiRequest(`/api/teams/${selectedTeamDetail.id}`, { method: "DELETE" });
      setSelectedTeamDetail(null);
      setAppMessage("Team deleted");
      loadTeams();
      loadTasks();
    } catch (err) {
      setAppMessage(err.message || "Failed to delete team");
    }
  };

  const handleSetMemberRole = async (member, role) => {
    try {
      const res = await apiRequest(`/api/teams/${selectedTeamDetail.id}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: member.user_id, team_role: role }),
      });
      setAppMessage(res.message || "Role updated");
      await refreshSelectedTeam();
    } catch (err) {
      setAppMessage(err.message || "Failed to change role");
    }
  };

  // ----------------------------------------------------
  // 6.1. ADMIN ACTIONS (ARCHITECT ONLY)
  // ----------------------------------------------------
  const loadAdminUsers = async () => {
    setIsLoadingAdminUsers(true);
    try {
      const data = await apiRequest("/api/admin/users");
      setAdminUsers(data.users || []);
    } catch (err) {
      setAppMessage(err.message || "Failed to load system users");
    } finally {
      setIsLoadingAdminUsers(false);
    }
  };

  const handleUpdateUserRole = async (userId, newRole) => {
    setIsUpdatingUserRole(true);
    try {
      const res = await apiRequest(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ system_role: newRole }),
      });
      setAppMessage(res.message || `Role updated to ${newRole}`);
      await loadAdminUsers();
    } catch (err) {
      setAppMessage(err.message || "Failed to update role");
    } finally {
      setIsUpdatingUserRole(false);
    }
  };

  const handleToggleUserStatus = async (userId, currentStatus) => {
    const newStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setIsUpdatingUserRole(true);
    try {
      const res = await apiRequest(`/api/admin/users/${userId}/status`, {
        method: "PUT",
        body: JSON.stringify({ account_status: newStatus }),
      });
      setAppMessage(res.message || `Account status changed to ${newStatus}`);
      await loadAdminUsers();
    } catch (err) {
      setAppMessage(err.message || "Failed to update user status");
    } finally {
      setIsUpdatingUserRole(false);
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Are you sure you want to permanently delete user "${userEmail}"?\nThis action will remove their access and all active memberships.`)) {
      return;
    }
    setIsUpdatingUserRole(true);
    try {
      const res = await apiRequest(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      setAppMessage(res.message || `User ${userEmail} deleted successfully`);
      await loadAdminUsers();
      await loadWorkspaceUsers();
    } catch (err) {
      setAppMessage(err.message || "Failed to delete user");
    } finally {
      setIsUpdatingUserRole(false);
    }
  };

  // ----------------------------------------------------
  // 7. COMPUTED STATS & FILTERED TASKS
  // ----------------------------------------------------
  const myUserId = userProfile?.id;
  const isPrivilegedUser = userProfile?.system_role === "ARCHITECT" || userProfile?.system_role === "ADMIN";

  const selectedTaskTeam = teams.find((t) => t.id === taskTeamId);
  const availableAssignees = selectedTaskTeam
    ? (selectedTaskTeam.members || [])
        .map((m) => ({
          id: m.user_id || m.id,
          email: m.email,
          display_name: m.display_name,
        }))
        .filter((m) => m.id !== myUserId)
    : isPrivilegedUser
    ? workspaceUsers.filter((u) => u.id !== myUserId)
    : [];

  const handleTaskTeamChange = (newTeamId) => {
    setTaskTeamId(newTeamId);
    setTaskAssigneeId("");
  };

  const myTasksCount = tasks.filter(
    (t) => t.created_by === myUserId || t.owner_user_id === myUserId || t.assigned_user_id === myUserId
  ).length;

  const teamTasksCount = tasks.filter((t) => Boolean(t.assigned_team_id)).length;
  const totalCount = tasks.length;
  const activeCount = tasks.filter((t) => t.status !== "COMPLETED").length;
  const doneCount = tasks.filter((t) => t.status === "COMPLETED").length;

  const selectedOverviewUser =
    workspaceUsers.find((u) => u.id === selectedUserOverviewId) ||
    workspaceUsers[0] ||
    null;

  const selectedUserTasks = selectedOverviewUser
    ? tasks.filter(
        (t) =>
          t.assigned_user_id === selectedOverviewUser.id ||
          t.owner_user_id === selectedOverviewUser.id ||
          t.created_by === selectedOverviewUser.id
      )
    : [];

  const filteredUserTasks = selectedUserTasks.filter((t) => {
    if (userOverviewStatusFilter === "pending" && t.status === "COMPLETED") return false;
    if (userOverviewStatusFilter === "completed" && t.status !== "COMPLETED") return false;
    return true;
  });

  const filteredTasks = tasks.filter((t) => {
    // 1. Tab filter
    if (activeTab === "my") {
      const isMine = t.created_by === myUserId || t.owner_user_id === myUserId || t.assigned_user_id === myUserId;
      if (!isMine) return false;
    } else if (activeTab === "teams") {
      if (!t.assigned_team_id) return false;
      if (selectedFilterTeamId && t.assigned_team_id !== selectedFilterTeamId) return false;
    } else if (activeTab === "org") {
      if (selectedFilterTeamId) {
        if (selectedFilterTeamId === "personal" && t.assigned_team_id) return false;
        if (selectedFilterTeamId !== "personal" && t.assigned_team_id !== selectedFilterTeamId) return false;
      }
    }

    // 2. Priority filter
    if (filterPriority && t.priority !== filterPriority) return false;

    // 3. Status filter
    if (filterStatus === "completed" && t.status !== "COMPLETED") return false;
    if (filterStatus === "pending" && t.status === "COMPLETED") return false;

    // 4. Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = t.title?.toLowerCase().includes(q);
      const matchDesc = t.description?.toLowerCase().includes(q);
      const matchTeam = t.assigned_team_name?.toLowerCase().includes(q);
      const matchOwner = (t.owner_name || t.owner_email)?.toLowerCase().includes(q);
      const matchCreator = (t.created_by_name || t.created_by_email)?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchTeam && !matchOwner && !matchCreator) return false;
    }

    return true;
  });

  const pendingFilteredTasks = filteredTasks.filter((t) => t.status !== "COMPLETED");
  const completedFilteredTasks = filteredTasks.filter((t) => t.status === "COMPLETED");

  const renderTaskCard = (t) => {
    const isCompleted = t.status === "COMPLETED";
    const isUnownedTeamTask = t.assigned_team_id && !t.owner_user_id;
    const myTeamRole = teams.find((tm) => tm.id === t.assigned_team_id)?.my_role;
    const canDelete = isPrivilegedUser || t.created_by === myUserId || myTeamRole === "LEADER";
    const canEdit =
      isPrivilegedUser || t.created_by === myUserId || t.owner_user_id === myUserId ||
      t.assigned_user_id === myUserId || myTeamRole === "LEADER";
    const todayStr = new Date().toLocaleDateString("en-CA");
    const isOverdue = t.due_date && t.due_date < todayStr && t.status !== "COMPLETED" && t.status !== "CANCELLED";

    return (
      <div
        key={t.id}
        id={`task-${t.id}`}
        className={`task-card ${isCompleted ? "task-completed" : ""}`}
      >
        <div className="task-check">
          <button
            className={`check-button ${isCompleted ? "checked" : ""}`}
            onClick={() => handleToggleComplete(t)}
            title={isCompleted ? "Mark incomplete" : "Mark complete"}
          >
            {isCompleted ? "✓" : ""}
          </button>
        </div>

        <div className="task-content">
          <h3>{t.title}</h3>
          {t.description && <p>{t.description}</p>}

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "6px" }}>
            <span className={`task-status ${isCompleted ? "done" : "active"}`}>
              {t.status}
            </span>

            <span
              style={{
                fontSize: "10px",
                padding: "3px 7px",
                borderRadius: "999px",
                fontWeight: "750",
                background:
                  t.priority === "HIGH"
                    ? "#fee2e2"
                    : t.priority === "MEDIUM"
                    ? "#fef3c7"
                    : "#ecfdf5",
                color:
                  t.priority === "HIGH"
                    ? "#dc2626"
                    : t.priority === "MEDIUM"
                    ? "#d97706"
                    : "#16a34a",
              }}
            >
              {t.priority}
            </span>

            {t.due_date && (
              <span
                style={{
                  fontSize: "11px", padding: "3px 8px", borderRadius: "999px", fontWeight: 650,
                  background: isOverdue ? "#fee2e2" : "#f1f5f9",
                  color: isOverdue ? "#b91c1c" : "#475569",
                }}
              >
                📅 {t.due_date}{isOverdue && " • overdue"}
              </span>
            )}

            {t.assigned_team_name ? (
              <span
                style={{
                  fontSize: "11px",
                  padding: "3px 8px",
                  borderRadius: "999px",
                  background: "#e0e7ff",
                  color: "#4338ca",
                  fontWeight: "600",
                }}
              >
                👥 {t.assigned_team_name}
              </span>
            ) : (
              <span
                style={{
                  fontSize: "11px",
                  padding: "3px 8px",
                  borderRadius: "999px",
                  background: "#f1f5f9",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                👤 Personal
              </span>
            )}

            {t.owner_name && (
              <span style={{ fontSize: "11px", color: "#475569" }}>
                Claimed: <strong>{t.owner_name}</strong>
              </span>
            )}

            {(activeTab === "org" || activeTab === "teams") && (t.created_by_email || t.created_by_name) && (
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                Created by: <strong>{t.created_by_email || t.created_by_name}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="task-actions">
          <select className="status-select" value={t.status}
                  onChange={(e) => handleChangeStatus(t, e.target.value)} title="Change status">
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {isUnownedTeamTask && (
            <button
              className="action-button"
              onClick={() => handleClaimTask(t)}
              style={{ borderColor: "#6366f1", color: "#4f46e5" }}
            >
              Claim Task
            </button>
          )}

          {canEdit && (
            <button className="action-button" onClick={() => setEditingTaskItem(t)} title="Edit task">
              ✏️
            </button>
          )}

          {canDelete && (
            <button
              className="action-button"
              onClick={() => handleDeleteTask(t)}
              style={{ color: "#ef4444" }}
              title="Delete task"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    );
  };

  // ----------------------------------------------------
  // RENDER: INITIAL AUTH RESTORATION LOADER
  // ----------------------------------------------------
  if (isAuthChecking) {
    return (
      <div className="auth-page" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#64748b" }}>
          <div className="brand-icon" style={{ margin: "0 auto 16px" }}>✓</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>TaskFlow V4</div>
          <p style={{ fontSize: "13px", marginTop: "6px" }}>Restoring your session...</p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // RENDER: AUTH VIEW (WHEN LOGGED OUT)
  // ----------------------------------------------------
  if (!session) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="brand-section">
            <div className="brand-icon">✓</div>
            <h1>TaskFlow V4</h1>
            <p className="subtitle">Collaborative Task & Team Management</p>

            <div className="connection-status" style={{ flexWrap: "wrap", justifyContent: "center", gap: "6px" }}>
              <span className={`status-dot ${backendStatus === "waking up" ? "retrying" : backendStatus}`}></span>
              <span>Backend: {getStatusLabel()}</span>
              {backendStatus === "offline" && (
                <button
                  type="button"
                  onClick={() => checkHealth(0)}
                  style={{
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "3px 10px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 700,
                    marginLeft: "4px",
                    transition: "all 0.2s",
                  }}
                  title="Ping Render backend to wake it up"
                >
                  ⚡ Wake Up Backend Now
                </button>
              )}
            </div>
            {backendStatus === "waking up" && (
              <div style={{ fontSize: "11px", color: "#f59e0b", margin: "6px 0 0", textAlign: "center", lineHeight: "1.4" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>⚡ Render is waking up the sleeping backend instance...</p>
                <p style={{ margin: "2px 0 0", opacity: 0.85 }}>Cloud containers take ~50-80s to boot from cold sleep.</p>
              </div>
            )}
          </div>

          <div className="auth-heading">
            <h2>{isLoginMode ? "Welcome back" : "Create your account"}</h2>
            <p>
              {isLoginMode
                ? "Enter your credentials to access your tasks."
                : "Create an account to collaborate with your teams."}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {!isLoginMode && (
              <div className="input-group">
                <label>Display Name</label>
                <input
                  type="text"
                  placeholder="Alex Doe"
                  value={authDisplayName}
                  onChange={(e) => setAuthDisplayName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="input-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="alex@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
            </div>

            <div className="input-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {!isLoginMode && (
              <div className="input-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={authConfirmPassword}
                  onChange={(e) => setAuthConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={authLoading}
            >
              {authLoading
                ? "Processing..."
                : isLoginMode
                ? "Sign In"
                : "Create Account"}
            </button>
          </form>

          

          

          {authMessage && (
            <div className="message" style={{ marginTop: "16px" }}>
              {authMessage}
            </div>
          )}

          <button
            className="switch-button"
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setAuthMessage("");
            }}
          >
            {isLoginMode
              ? "Need an account? Register here"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // RENDER: DASHBOARD VIEW (WHEN LOGGED IN)
  // ----------------------------------------------------
  return (
    <div className="dashboard-page">
      <div className="dashboard">
        {/* HEADER */}
        <header className="dashboard-header">
          <div>
            <div className="brand-small">
              <span className="brand-icon small">✓</span>
              TaskFlow V4
            </div>
            <h1>Task Dashboard</h1>
            <p>
              Logged in as <strong>{userProfile?.display_name || userProfile?.email || session.user.email}</strong>
              {" • "}
              <span className="task-status active" style={{ marginLeft: "6px" }}>
                {userProfile?.system_role || "USER"}
              </span>
            </p>
          </div>

          <div className={`header-actions ${menuOpen ? "open" : ""}`}>
            <button className="action-button keep menu-toggle" onClick={() => setMenuOpen((o) => !o)}
                    aria-label="Menu" style={{ minHeight: "40px" }}>☰</button>
            <button className="action-button keep" onClick={toggleTheme} title="Toggle dark / light"
                    style={{ minHeight: "40px", padding: "0 12px" }}>
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <div className="connection-status header-status">
              <span className={`status-dot ${backendStatus === "waking up" ? "retrying" : backendStatus}`}></span>
              <span>{getStatusLabel()}</span>
              {backendStatus === "offline" && (
                <button
                  type="button"
                  onClick={() => checkHealth(0)}
                  style={{
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "2px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 700,
                    marginLeft: "6px",
                  }}
                  title="Retry connecting to backend"
                >
                  ⚡ Wake Up
                </button>
              )}
            </div>
            {userProfile?.system_role === "ARCHITECT" && (
              <button
                className="action-button"
                onClick={() => {
                  setShowAdminModal(true);
                  loadAdminUsers();
                }}
                style={{
                  minHeight: "40px",
                  padding: "0 14px",
                  fontWeight: "700",
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fde68a",
                }}
              >
                👑 Architect Panel
              </button>
            )}

            
            <button
              className="action-button"
              onClick={() => {
                setSelectedTeamDetail(null);
                setShowTeamModal(true);
              }}
              style={{ minHeight: "40px", padding: "0 14px", fontWeight: "700" }}
            >
              👥 Teams ({teams.length})
            </button>
            <button
              className="action-button"
              onClick={() => setShowProfileModal(true)}
              style={{ minHeight: "40px", padding: "0 14px", fontWeight: "700" }}
            >
              👤 Profile
            </button>
            <button className="logout-button" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </header>

        {appMessage && (
          <div
            className="message"
            style={{
              marginBottom: "20px",
              background: "#eef2ff",
              color: "#3730a3",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{appMessage}</span>
            <button
              onClick={() => setAppMessage("")}
              style={{ border: 0, background: "transparent", cursor: "pointer", fontWeight: "bold" }}
            >
              ×
            </button>
          </div>
        )}

        {/* METRIC / STAT CARDS */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon total">📋</div>
            <div>
              <span>Total Tasks</span>
              <strong>{totalCount}</strong>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon active">⏳</div>
            <div>
              <span>In Progress / Pending</span>
              <strong>{activeCount}</strong>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon done">✓</div>
            <div>
              <span>Completed</span>
              <strong>{doneCount}</strong>
            </div>
          </div>
        </div>

        {/* CREATE TASK FORM */}
        <div className="task-form-card">
          <div className="section-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h2>{isBulkMode ? "Bulk Add Tasks (Up to 10)" : "Create New Task"}</h2>
              <p>
                {isBulkMode
                  ? "Enter one task title per line. Max 10 tasks allowed per request."
                  : "Add personal items or allocate tasks directly to your teams."}
              </p>
            </div>
            <button
              className="action-button"
              onClick={() => setIsBulkMode(!isBulkMode)}
              style={{ fontSize: "12px" }}
            >
              {isBulkMode ? "Switch to Single Mode" : "⚡ Switch to Bulk Mode"}
            </button>
          </div>

          <form onSubmit={handleCreateTask}>
            {isBulkMode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="input-group">
                  <label>Task Titles (1 per line, max 10)</label>
                  <textarea
                    rows={4}
                    placeholder="Prepare presentation&#10;Update AWS EC2 instance&#10;Run security review"
                    value={bulkLines}
                    onChange={(e) => setBulkLines(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Priority</label>
                    <select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value)}
                      style={{ height: "48px", borderRadius: "11px", border: "1px solid #d9dee8", padding: "0 12px" }}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Team Scope</label>
                    <select
                      value={taskTeamId}
                      onChange={(e) => handleTaskTeamChange(e.target.value)}
                      style={{ height: "48px", borderRadius: "11px", border: "1px solid #d9dee8", padding: "0 10px" }}
                    >
                      <option value="">Personal / No Team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          Team: #{t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Assign to User (Sends Email)</label>
                    <select
                      value={taskAssigneeId}
                      onChange={(e) => setTaskAssigneeId(e.target.value)}
                      disabled={!taskTeamId && !isPrivilegedUser}
                      style={{
                        height: "48px",
                        borderRadius: "11px",
                        border: "1px solid #d9dee8",
                        padding: "0 10px",
                        opacity: (!taskTeamId && !isPrivilegedUser) ? 0.7 : 1,
                        cursor: (!taskTeamId && !isPrivilegedUser) ? "not-allowed" : "default"
                      }}
                    >
                      <option value="">
                        {taskTeamId ? "Unassigned (Team can claim)" : "Myself (Personal)"}
                      </option>
                      {availableAssignees.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name ? `${u.display_name} (${u.email})` : u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="primary-button add-button"
                    disabled={isCreatingTask}
                    style={{ alignSelf: "flex-end", height: "48px" }}
                  >
                    {isCreatingTask ? "Creating..." : "Add All Tasks"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="task-form">
                <div className="input-group">
                  <label>Title</label>
                  <input
                    type="text"
                    placeholder="What needs to be done?"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Description</label>
                  <input
                    type="text"
                    placeholder="Additional context or links..."
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <div className="input-group" style={{ width: "150px" }}>
                    <label>Due date</label>
                    <input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)}
                           style={{ minHeight: "48px" }} />
                  </div>
                  <div className="input-group" style={{ width: "105px" }}>
                    <label>Priority</label>
                    <select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value)}
                      style={{ height: "48px", borderRadius: "11px", border: "1px solid #d9dee8", padding: "0 8px" }}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ minWidth: "150px", flex: 1 }}>
                    <label>Team Scope</label>
                    <select
                      value={taskTeamId}
                      onChange={(e) => handleTaskTeamChange(e.target.value)}
                      style={{ height: "48px", borderRadius: "11px", border: "1px solid #d9dee8", padding: "0 8px" }}
                    >
                      <option value="">Personal (No Team)</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          #{t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ minWidth: "180px", flex: 1 }}>
                    <label>Assign to User (Sends Email)</label>
                    <select
                      value={taskAssigneeId}
                      onChange={(e) => setTaskAssigneeId(e.target.value)}
                      disabled={!taskTeamId && !isPrivilegedUser}
                      style={{
                        height: "48px",
                        borderRadius: "11px",
                        border: "1px solid #d9dee8",
                        padding: "0 8px",
                        opacity: (!taskTeamId && !isPrivilegedUser) ? 0.7 : 1,
                        cursor: (!taskTeamId && !isPrivilegedUser) ? "not-allowed" : "default"
                      }}
                    >
                      <option value="">
                        {taskTeamId ? "Unassigned (Team can claim)" : "Myself (Personal)"}
                      </option>
                      {availableAssignees.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name ? `${u.display_name} (${u.email})` : u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="primary-button add-button"
                    disabled={isCreatingTask}
                  >
                    {isCreatingTask ? "Adding..." : "+ Add"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* TASK LIST & FILTERS */}
        <div className="task-list">
          {/* VIEW TABS */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: "12px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("my");
                  setSelectedFilterTeamId("");
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "13px",
                  background: activeTab === "my" ? "#4f46e5" : "#f1f5f9",
                  color: activeTab === "my" ? "white" : "#475569",
                  transition: "all 0.15s ease",
                }}
              >
                📌 My Tasks ({myTasksCount})
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab("teams");
                  setSelectedFilterTeamId("");
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "13px",
                  background: activeTab === "teams" ? "#4f46e5" : "#f1f5f9",
                  color: activeTab === "teams" ? "white" : "#475569",
                  transition: "all 0.15s ease",
                }}
              >
                👥 Team Tasks ({teamTasksCount})
              </button>

              {isPrivilegedUser && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("org");
                    setSelectedFilterTeamId("");
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "10px",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "13px",
                    background: activeTab === "org" ? "#92400e" : "#fef3c7",
                    color: activeTab === "org" ? "white" : "#92400e",
                    transition: "all 0.15s ease",
                  }}
                >
                  🌐 Org Overview ({totalCount})
                </button>
              )}

              {isPrivilegedUser && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("users");
                    setSelectedFilterTeamId("");
                    if (!selectedUserOverviewId && workspaceUsers.length > 0) {
                      setSelectedUserOverviewId(workspaceUsers[0].id);
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "10px",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "13px",
                    background: activeTab === "users" ? "#0f766e" : "#ccfbf1",
                    color: activeTab === "users" ? "white" : "#0f766e",
                    transition: "all 0.15s ease",
                  }}
                >
                  👥 Member Tasks ({workspaceUsers.length})
                </button>
              )}
            </div>

            <span className="task-count" style={{ fontSize: "13px" }}>
              {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
            </span>
          </div>

          {activeTab === "users" && isPrivilegedUser ? (
            /* ADMIN USER DIRECTORY & WORKLOAD OVERSIGHT VIEW */
            <div className="workload-container" style={{ display: "flex", gap: "20px", marginTop: "16px", flexWrap: "wrap", alignItems: "flex-start" }}>
              {/* LEFT COLUMN: USER ROSTER */}
              <div style={{ flex: "1 1 290px", maxWidth: "340px", background: "var(--card-bg, #ffffff)", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "14px", padding: "16px", boxSizing: "border-box" }}>
                <div style={{ marginBottom: "12px" }}>
                  <h3 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700, color: "var(--text-primary, #1e293b)" }}>Organization Members</h3>
                  <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#64748b" }}>Select a member to view all their tasks</p>
                  <input
                    type="text"
                    placeholder="🔍 Filter members..."
                    value={userOverviewSearch}
                    onChange={(e) => setUserOverviewSearch(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border-color, #d9dee7)", fontSize: "13px", boxSizing: "border-box", background: "var(--input-bg, #ffffff)", color: "var(--text-primary, #0f172a)" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "580px", overflowY: "auto" }}>
                  {workspaceUsers
                    .filter((u) => {
                      if (!userOverviewSearch.trim()) return true;
                      const q = userOverviewSearch.toLowerCase();
                      return (u.email || "").toLowerCase().includes(q) || (u.display_name || "").toLowerCase().includes(q);
                    })
                    .map((u) => {
                      const isSelected = (selectedOverviewUser?.id === u.id);
                      const userPendingCount = tasks.filter(t => (t.assigned_user_id === u.id || t.owner_user_id === u.id) && t.status !== "COMPLETED").length;
                      return (
                        <div
                          key={u.id}
                          onClick={() => setSelectedUserOverviewId(u.id)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "10px",
                            cursor: "pointer",
                            background: isSelected ? "rgba(15, 118, 110, 0.12)" : "transparent",
                            border: isSelected ? "1.5px solid #0f766e" : "1px solid transparent",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1, paddingRight: "8px" }}>
                            <div style={{ fontWeight: 650, fontSize: "13px", color: isSelected ? "#0f766e" : "var(--text-primary, #1e293b)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                              {u.display_name || u.email.split("@")[0]}
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{u.email}</div>
                            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                              <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "4px", fontWeight: 700, background: u.system_role === "ARCHITECT" ? "#fef3c7" : u.system_role === "ADMIN" ? "#ede9fe" : "#f1f5f9", color: u.system_role === "ARCHITECT" ? "#92400e" : u.system_role === "ADMIN" ? "#5b21b6" : "#475569" }}>
                                {u.system_role}
                              </span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", background: userPendingCount > 0 ? "#fee2e2" : "#f1f5f9", color: userPendingCount > 0 ? "#b91c1c" : "#64748b", whiteSpace: "nowrap" }} title="Active / Pending tasks">
                              {userPendingCount} active
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* RIGHT COLUMN: SELECTED USER WORKLOAD DETAILS */}
              <div style={{ flex: "2 1 450px", background: "var(--card-bg, #ffffff)", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "14px", padding: "20px", boxSizing: "border-box" }}>
                {selectedOverviewUser ? (
                  <div>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", borderBottom: "1px solid var(--border-color, #f1f5f9)", paddingBottom: "16px", marginBottom: "16px" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <h2 style={{ margin: 0, fontSize: "18px", color: "var(--text-primary, #0f172a)" }}>
                            {selectedOverviewUser.display_name || selectedOverviewUser.email}
                          </h2>
                          <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", fontWeight: 700, background: "#e0f2fe", color: "#0369a1" }}>
                            {selectedOverviewUser.system_role}
                          </span>
                        </div>
                        <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>
                          {selectedOverviewUser.email}
                        </p>
                      </div>
                      
                    </div>

                    {/* User Task Stat Cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px", marginBottom: "20px" }}>
                      <div style={{ padding: "10px 14px", background: "var(--bg-secondary, #f8fafc)", borderRadius: "10px", border: "1px solid var(--border-color, #e2e8f0)" }}>
                        <div style={{ fontSize: "11px", color: "#64748b" }}>Total Tasks</div>
                        <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-primary, #1e293b)" }}>{selectedUserTasks.length}</div>
                      </div>
                      <div style={{ padding: "10px 14px", background: "#fffbeb", borderRadius: "10px", border: "1px solid #fef3c7" }}>
                        <div style={{ fontSize: "11px", color: "#b45309" }}>Pending / Active</div>
                        <div style={{ fontSize: "18px", fontWeight: 800, color: "#b45309" }}>
                          {selectedUserTasks.filter(t => t.status !== "COMPLETED").length}
                        </div>
                      </div>
                      <div style={{ padding: "10px 14px", background: "#f0fdf4", borderRadius: "10px", border: "1px solid #bbf7d0" }}>
                        <div style={{ fontSize: "11px", color: "#15803d" }}>Completed</div>
                        <div style={{ fontSize: "18px", fontWeight: 800, color: "#15803d" }}>
                          {selectedUserTasks.filter(t => t.status === "COMPLETED").length}
                        </div>
                      </div>
                    </div>

                    {/* Sub-filters for user tasks */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {["all", "pending", "completed"].map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setUserOverviewStatusFilter(st)}
                            style={{
                              padding: "5px 12px",
                              borderRadius: "6px",
                              border: "none",
                              fontSize: "12px",
                              fontWeight: 650,
                              cursor: "pointer",
                              background: userOverviewStatusFilter === st ? "#0f766e" : "var(--bg-secondary, #f1f5f9)",
                              color: userOverviewStatusFilter === st ? "white" : "var(--text-primary, #475569)",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {st === "all" ? "All Tasks" : st === "pending" ? "Pending / Active" : "Completed"}
                          </button>
                        ))}
                      </div>
                      <span style={{ fontSize: "12px", color: "#64748b" }}>
                        Showing {filteredUserTasks.length} task{filteredUserTasks.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* Task List */}
                    {filteredUserTasks.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
                        <div style={{ fontSize: "28px", marginBottom: "8px" }}>📭</div>
                        No tasks found for this member in this status.
                      </div>
                    ) : (
                      <div className="task-items" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {filteredUserTasks.map((t) => renderTaskCard(t))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "50px", color: "#94a3b8" }}>
                    Select a member on the left to view their workload.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* SEARCH & FILTERS TOOLBAR */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "20px" }}>
            {/* Search Input */}
            <div style={{ flex: 1, minWidth: "220px", position: "relative" }}>
              <input
                type="text"
                placeholder="🔍 Search tasks, descriptions, or teammates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "1px solid #d9dee7",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  background: "#f8fafc",
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontWeight: "bold",
                    fontSize: "14px",
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {/* Team Filter Dropdown (shown in teams or org tab) */}
            {(activeTab === "teams" || activeTab === "org") && (
              <select
                value={selectedFilterTeamId}
                onChange={(e) => setSelectedFilterTeamId(e.target.value)}
                style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid #d9dee7", fontSize: "13px", background: "white" }}
              >
                <option value="">All Teams</option>
                {activeTab === "org" && <option value="personal">Personal Tasks Only</option>}
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}

            {/* Priority Filter */}
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid #d9dee7", fontSize: "13px", background: "white" }}
            >
              <option value="">All Priorities</option>
              <option value="HIGH">High Priority</option>
              <option value="MEDIUM">Medium Priority</option>
              <option value="LOW">Low Priority</option>
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid #d9dee7", fontSize: "13px", background: "white" }}
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>

          {isLoadingTasks ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#818a9c" }}>
              Loading tasks...
            </div>
          ) : filteredTasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#818a9c" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>🏖️</div>
              <strong>No tasks found in this view.</strong>
              <p style={{ margin: "5px 0 0", fontSize: "13px" }}>
                {searchQuery ? "Try adjusting your search or filters." : "Create one above to get started!"}
              </p>
            </div>
          ) : filterStatus !== "all" ? (
            /* Single list if filtered to pending or completed only */
            <div className="task-items">
              {filteredTasks.map((t) => renderTaskCard(t))}
            </div>
          ) : (
            /* Grouped Sections: Pending vs Completed */
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* PENDING SECTION */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "16px" }}>⏳</span>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#1e293b" }}>
                    In Progress & Pending ({pendingFilteredTasks.length})
                  </h3>
                </div>
                {pendingFilteredTasks.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0, padding: "10px 0" }}>
                    🎉 No pending tasks! All caught up.
                  </p>
                ) : (
                  <div className="task-items">
                    {pendingFilteredTasks.map((t) => renderTaskCard(t))}
                  </div>
                )}
              </div>

              {/* COMPLETED SECTION */}
              {completedFilteredTasks.length > 0 && (
                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <span style={{ fontSize: "16px" }}>✓</span>
                    <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#64748b" }}>
                      Completed ({completedFilteredTasks.length})
                    </h3>
                  </div>
                  <div className="task-items">
                    {completedFilteredTasks.map((t) => renderTaskCard(t))}
                  </div>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {/* TEAMS MANAGEMENT MODAL */}
      {showTeamModal && (
        <div
          onClick={() => setShowTeamModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "20px",
              padding: "28px",
              maxWidth: "580px",
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {/* If selectedTeamDetail is active, show the Team Detail & Member Roster view */}
            {selectedTeamDetail ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTeamDetail(null);
                      setNewMemberEmail("");
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#4f46e5",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: 0,
                    }}
                  >
                    ← Back to All Teams
                  </button>
                  <button
                    onClick={() => {
                      setShowTeamModal(false);
                      setSelectedTeamDetail(null);
                    }}
                    style={{ border: 0, background: "transparent", fontSize: "22px", cursor: "pointer", color: "#64748b" }}
                  >
                    ×
                  </button>
                </div>

                <div style={{ paddingBottom: "16px", borderBottom: "1px solid #e2e8f0", marginBottom: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h2 style={{ margin: 0, fontSize: "20px", color: "#0f172a" }}>{selectedTeamDetail.name}</h2>
                    <span className="task-status active" style={{ fontSize: "12px" }}>
                      Your Role: {selectedTeamDetail.my_role || (isPrivilegedUser ? "ADMIN" : "MEMBER")}
                    </span>
                  </div>
                  {selectedTeamDetail.description && (
                    <p style={{ margin: "6px 0 0", fontSize: "14px", color: "#64748b" }}>
                      {selectedTeamDetail.description}
                    </p>
                  )}
                </div>

                {(selectedTeamDetail.my_role === "LEADER" || isPrivilegedUser) && (
                  <div className="team-manage-bar">
                    {!editingTeam ? (
                      <>
                        <button type="button" className="action-button" onClick={() => {
                          setEditTeamName(selectedTeamDetail.name);
                          setEditTeamDesc(selectedTeamDetail.description || "");
                          setEditingTeam(true);
                        }}>✏️ Edit team</button>
                        <button type="button" className="action-button" style={{ color: "#ef4444" }}
                                onClick={handleDeleteTeam}>🗑️ Delete team</button>
                      </>
                    ) : (
                      <form onSubmit={handleSaveTeamEdit}>
                        <input value={editTeamName} onChange={(e) => setEditTeamName(e.target.value)}
                               placeholder="Team name" required maxLength={100} />
                        <textarea rows={2} value={editTeamDesc} onChange={(e) => setEditTeamDesc(e.target.value)}
                                  placeholder="Description (optional)" />
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button type="submit" className="primary-button" style={{ padding: "8px 14px", fontSize: "13px" }}>Save</button>
                          <button type="button" className="action-button" onClick={() => setEditingTeam(false)}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Team Members Roster */}
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px", color: "#334155" }}>
                    Team Members ({selectedTeamDetail.members?.length || 0})
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {selectedTeamDetail.members && selectedTeamDetail.members.length > 0 ? (
                      selectedTeamDetail.members.map((m) => (
                        <div
                          key={m.user_id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 14px",
                            borderRadius: "10px",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "14px", color: "#1e293b" }}>
                              {m.display_name || m.email || "Unknown User"}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748b" }}>
                              {m.email} {m.user_id === userProfile?.id && "(You)"}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                padding: "3px 8px",
                                borderRadius: "999px",
                                background: m.team_role === "LEADER" ? "#e0e7ff" : "#f1f5f9",
                                color: m.team_role === "LEADER" ? "#4338ca" : "#475569",
                              }}
                            >
                              {m.team_role}
                            </span>
                            {(selectedTeamDetail.my_role === "LEADER" || isPrivilegedUser) && m.user_id !== userProfile?.id && (
                              <button type="button"
                                onClick={() => handleSetMemberRole(m, m.team_role === "LEADER" ? "MEMBER" : "LEADER")}
                                style={{ border: "none", background: "transparent", color: "#4f46e5",
                                         cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "4px 8px" }}>
                                {m.team_role === "LEADER" ? "Demote" : "Make Leader"}
                              </button>
                            )}

                            {(selectedTeamDetail.my_role === "LEADER" || userProfile?.system_role === "ARCHITECT" || userProfile?.system_role === "ADMIN" || m.user_id === userProfile?.id) && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m.user_id, m.display_name || m.email)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#ef4444",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  padding: "4px 8px",
                                }}
                              >
                                {m.user_id === userProfile?.id ? "Leave" : "Remove"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p style={{ fontSize: "13px", color: "#94a3b8" }}>No members found.</p>
                    )}
                  </div>
                </div>

                {/* Add Member Form */}
                <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                    + Add Teammate by Email
                  </h4>
                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "#64748b" }}>
                    User must already have signed up on TaskFlow.
                  </p>
                  <form onSubmit={handleAddMember} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <input
                        type="email"
                        placeholder="teammate@example.com"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                        required
                        style={{
                          flex: 1,
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          fontSize: "14px",
                        }}
                      />
                      <select
                        value={newMemberRole}
                        onChange={(e) => setNewMemberRole(e.target.value)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          fontSize: "14px",
                          background: "white",
                        }}
                      >
                        <option value="MEMBER">Member</option>
                        <option value="LEADER">Leader</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={isAddingMember}
                      style={{ padding: "10px 16px", fontSize: "14px" }}
                    >
                      {isAddingMember ? "Adding..." : "+ Add Teammate"}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              /* All Teams List & Create Team Form */
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <h2 style={{ margin: 0, fontSize: "20px" }}>Your Teams</h2>
                  <button
                    onClick={() => {
                      setShowTeamModal(false);
                      setSelectedTeamDetail(null);
                    }}
                    style={{ border: 0, background: "transparent", fontSize: "22px", cursor: "pointer", color: "#64748b" }}
                  >
                    ×
                  </button>
                </div>

                {/* List existing teams */}
                <div style={{ marginBottom: "24px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                    {teams.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>No teams yet. Create your first team below!</p>
                    ) : (
                      teams.map((t) => (
                        <div
                          key={t.id}
                          style={{
                            padding: "12px 16px",
                            borderRadius: "12px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: "15px", color: "#0f172a" }}>{t.name}</strong>
                            {t.description && <div style={{ fontSize: "13px", color: "#64748b" }}>{t.description}</div>}
                            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                              {t.member_count || 1} {t.member_count === 1 ? "member" : "members"} • Role: {t.my_role || (isPrivilegedUser ? "ADMIN VIEW" : "MEMBER")}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleSelectTeam(t)}
                            disabled={isLoadingTeamDetail}
                            style={{
                              padding: "6px 12px",
                              fontSize: "13px",
                              fontWeight: 600,
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              background: "white",
                              cursor: "pointer",
                            }}
                          >
                            Manage Members →
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Create team form */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}>
                  <form onSubmit={handleCreateTeam} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <strong style={{ fontSize: "14px", color: "#334155" }}>Create a New Team:</strong>
                    <input
                      type="text"
                      placeholder="Team Name (e.g. Backend Platform)"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      required
                      style={{ padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1" }}
                    />
                    <input
                      type="text"
                      placeholder="Team Description (optional)"
                      value={newTeamDesc}
                      onChange={(e) => setNewTeamDesc(e.target.value)}
                      style={{ padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1" }}
                    />
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={isCreatingTeam}
                      style={{ marginTop: "6px" }}
                    >
                      {isCreatingTeam ? "Creating..." : "+ Create Team"}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ARCHITECT ADMIN PANEL MODAL */}
      {showAdminModal && userProfile?.system_role === "ARCHITECT" && (
        <div
          onClick={() => setShowAdminModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "20px",
              padding: "28px",
              maxWidth: "640px",
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "20px", color: "#0f172a" }}>👑 System Users & Roles</h2>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>
                  Only visible to Architect. Promote users to Admin or manage system roles.
                </p>
              </div>
              <button
                onClick={() => setShowAdminModal(false)}
                style={{ border: 0, background: "transparent", fontSize: "22px", cursor: "pointer", color: "#64748b" }}
              >
                ×
              </button>
            </div>

            {isLoadingAdminUsers ? (
              <p style={{ color: "#64748b", fontSize: "14px" }}>Loading registered users...</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
                {adminUsers.length === 0 ? (
                  <p style={{ color: "#94a3b8", fontSize: "13px" }}>No users registered yet.</p>
                ) : (
                  adminUsers.map((u) => {
                    const isSelf = u.id === userProfile?.id;
                    return (
                      <div
                        key={u.id}
                        style={{
                          padding: "12px 16px",
                          borderRadius: "12px",
                          border: "1px solid #e2e8f0",
                          background: isSelf ? "#fdfbf7" : "#f8fafc",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: "#1e293b" }}>
                            {u.display_name || u.email} {isSelf && "(You - Architect)"}
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>{u.email}</div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: "999px",
                              background:
                                u.account_status === "ACTIVE" ? "#dcfce7" : "#fee2e2",
                              color:
                                u.account_status === "ACTIVE" ? "#15803d" : "#b91c1c",
                            }}
                          >
                            {u.account_status || "ACTIVE"}
                          </span>

                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "4px 9px",
                              borderRadius: "999px",
                              background:
                                u.system_role === "ARCHITECT"
                                  ? "#fef3c7"
                                  : u.system_role === "ADMIN"
                                  ? "#dbeafe"
                                  : "#f1f5f9",
                              color:
                                u.system_role === "ARCHITECT"
                                  ? "#92400e"
                                  : u.system_role === "ADMIN"
                                  ? "#1e40af"
                                  : "#475569",
                            }}
                          >
                            {u.system_role}
                          </span>

                          {!isSelf && u.system_role !== "ARCHITECT" && (
                            <>
                              <select
                                value={u.system_role}
                                disabled={isUpdatingUserRole}
                                onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                                style={{
                                  padding: "5px 8px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  fontSize: "12px",
                                  background: "white",
                                  cursor: "pointer",
                                  fontWeight: 500,
                                }}
                              >
                                <option value="USER">USER</option>
                                <option value="ADMIN">ADMIN</option>
                              </select>

                              <button
                                type="button"
                                disabled={isUpdatingUserRole}
                                onClick={() => handleToggleUserStatus(u.id, u.account_status)}
                                style={{
                                  padding: "5px 9px",
                                  borderRadius: "8px",
                                  border: "1px solid #cbd5e1",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  background: "#f8fafc",
                                  color: "#334155",
                                  cursor: "pointer",
                                }}
                                title={u.account_status === "ACTIVE" ? "Suspend user" : "Activate user"}
                              >
                                {u.account_status === "ACTIVE" ? "Suspend" : "Activate"}
                              </button>

                              <button
                                type="button"
                                disabled={isUpdatingUserRole}
                                onClick={() => handleDeleteUser(u.id, u.email)}
                                style={{
                                  padding: "5px 10px",
                                  borderRadius: "8px",
                                  border: "1px solid #fca5a5",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  background: "#fee2e2",
                                  color: "#dc2626",
                                  cursor: "pointer",
                                  transition: "all 0.15s ease",
                                }}
                                title="Permanently delete user"
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {editingTaskItem && (
        <TaskEditModal task={editingTaskItem} onClose={() => setEditingTaskItem(null)} onSave={handleSaveTaskEdit} />
      )}
      {showProfileModal && (
        <ProfileModal
          user={userProfile}
          onClose={() => setShowProfileModal(false)}
          onSaved={(u) => setUserProfile(u)}
          onMessage={setAppMessage}
        />
      )}
    </div>
  );
}
