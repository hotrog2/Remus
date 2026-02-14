const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("remusManager", {
  loadConfig: () => ipcRenderer.invoke("manager:config-load"),
  saveConfig: (config) => ipcRenderer.invoke("manager:config-save", config),
  getStatus: () => ipcRenderer.invoke("manager:status"),
  getLogs: () => ipcRenderer.invoke("manager:logs"),
  startServer: () => ipcRenderer.invoke("manager:server-start"),
  stopServer: () => ipcRenderer.invoke("manager:server-stop"),
  openFolder: () => ipcRenderer.invoke("manager:open-folder"),
  getIconInfo: () => ipcRenderer.invoke("manager:icon-info"),
  selectIcon: () => ipcRenderer.invoke("manager:icon-select"),
  setIconFromPath: (sourcePath) => ipcRenderer.invoke("manager:icon-set-path", sourcePath),
  clearIcon: () => ipcRenderer.invoke("manager:icon-clear"),
  allowFirewall: (config) => ipcRenderer.invoke("manager:firewall-allow", config),
  checkPorts: (config) => ipcRenderer.invoke("manager:ports-check", config),
  getUsers: () => ipcRenderer.invoke("manager:admin-users"),
  kickUser: (userId) => ipcRenderer.invoke("manager:admin-user-kick", userId),
  banUser: (userId) => ipcRenderer.invoke("manager:admin-user-ban", userId),
  getBans: () => ipcRenderer.invoke("manager:admin-bans"),
  unbanUser: (userId) => ipcRenderer.invoke("manager:admin-unban", userId),
  getMessages: (limit) => ipcRenderer.invoke("manager:admin-messages", limit),
  getUploads: (limit) => ipcRenderer.invoke("manager:admin-uploads", limit),
  getRoles: () => ipcRenderer.invoke("manager:admin-roles"),
  getMembers: () => ipcRenderer.invoke("manager:admin-members"),
  createRole: (payload) => ipcRenderer.invoke("manager:admin-role-create", payload),
  updateRole: (roleId, payload) => ipcRenderer.invoke("manager:admin-role-update", roleId, payload),
  deleteRole: (roleId) => ipcRenderer.invoke("manager:admin-role-delete", roleId),
  setMemberRoles: (userId, payload) => ipcRenderer.invoke("manager:admin-member-roles", userId, payload),
  getAudit: (limit) => ipcRenderer.invoke("manager:admin-audit", limit),
  getAdminSettings: () => ipcRenderer.invoke("manager:admin-settings"),
  saveAdminSettings: (payload) => ipcRenderer.invoke("manager:admin-settings-save", payload),
  getServerInfo: () => ipcRenderer.invoke("manager:server-info"),
  onStatus: (listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on("manager:status", wrapped);
    return () => ipcRenderer.off("manager:status", wrapped);
  },
  onLog: (listener) => {
    const wrapped = (_, payload) => listener(payload);
    ipcRenderer.on("manager:log", wrapped);
    return () => ipcRenderer.off("manager:log", wrapped);
  }
});
