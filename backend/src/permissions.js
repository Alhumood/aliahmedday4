// The fixed list of permissions a role can grant. Admins pick from these; new keys only come from code.
export const PERMISSIONS = [
  { key: "customers.view_all", description: "See and edit every customer, see owners and filter by owner. Without it, only own customers." },
  { key: "customers.own", description: "Customers can be assigned to this user." },
  { key: "customers.delete", description: "Delete the customers they can see." },
  { key: "customers.assign", description: "Bulk-assign customers to an owner. Needs customers.view_all." },
  { key: "customers.export", description: "Export customers to Excel or PDF." },
  { key: "knowledge.manage", description: "Add, edit and delete knowledge articles." },
  { key: "agent.use", description: "Use the AI Assistant." },
  { key: "users.manage", description: "Add, edit and delete users, and manage roles." },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Built-in roles, created on first use. Admin is locked; Sales can be renamed and edited.
export const SYSTEM_ROLES = {
  admin: { name: "Admin", permissions: PERMISSION_KEYS.filter((key) => key !== "customers.own") },
  sales: {
    name: "Sales",
    permissions: ["customers.own", "customers.delete", "customers.export", "knowledge.manage", "agent.use"],
  },
};

export const can = (user, key) => Boolean(user?.permissions?.includes(key));
