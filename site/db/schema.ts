// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("relay_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  operation: text("operation").notNull(),
  arguments: text("arguments").notNull(),
  state: text("state").notNull(),
  result: text("result"),
  created: integer("created").notNull(),
  dispatched: integer("dispatched"),
}, (table) => [index("tasks_state_created").on(table.state, table.created), index("tasks_user_created").on(table.userId, table.created)]);

export const relay = sqliteTable("relay_state", {
  id: text("id").primaryKey(), lastSeen: integer("last_seen").notNull(), allowSwitch: integer("allow_switch").notNull(),
  allowOfficialUpdate: integer("allow_official_update").notNull().default(0),
  allowStockUpdate: integer('allow_stock_update').notNull().default(0),
});

export const officialApprovals = sqliteTable("official_update_approvals", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  digest: text("digest").notNull(), expires: integer("expires").notNull(),
  used: integer("used").notNull().default(0),
  kind: text('kind').notNull().default('vendor_handoff'),
  routeReview: text('route_review'),
});

export const approvals = sqliteTable("switch_approvals", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), catalogId: text("catalog_id").notNull(),
  digest: text("digest").notNull(), entryMethod: text("entry_method").notNull(), expires: integer("expires").notNull(), used: integer("used").notNull().default(0),
});

export const forgeBaselines = sqliteTable("forge_baselines", {
  userId: text("user_id").primaryKey(), jobId: text("job_id").notNull(),
  sha256: text("sha256").notNull(), verifiedAt: integer("verified_at").notNull(),
});

export const forgeSettings = sqliteTable("forge_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(), settingKey: text("setting_key").notNull(),
  value: text("value").notNull(), updated: integer("updated").notNull(),
}, (table) => [uniqueIndex("forge_settings_owner_key").on(table.userId, table.settingKey)]);

export const forgeProjects = sqliteTable("forge_projects", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  title: text("title").notNull(), slug: text("slug").notNull(), config: text("config").notNull(),
  created: integer("created").notNull(), updated: integer("updated").notNull(),
}, (table) => [index("forge_projects_owner_updated").on(table.userId, table.updated)]);
