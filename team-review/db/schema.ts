import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  memberId: text("member_id").references(() => members.id),
  role: text("role").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  project: text("project").notNull(),
  matchGroup: text("match_group").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  duration: real("duration").notNull(),
  interval: real("interval_sec").notNull(),
  expectedFrames: integer("expected_frames").notNull(),
  status: text("status").notNull().default("importing"),
  createdAt: integer("created_at").notNull(),
});
export const frames = sqliteTable(
  "frames",
  {
    id: text("id").primaryKey(),
    clipId: text("clip_id")
      .notNull()
      .references(() => clips.id),
    seq: integer("seq").notNull(),
    timestamp: real("timestamp_sec").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    proposal: text("proposal").notNull(),
    model: text("model_name").notNull(),
    modelHash: text("model_hash"),
    assignee: text("assignee").references(() => members.id),
    state: text("state").notNull().default("pending"),
    version: integer("version").notNull().default(0),
    lastOperation: text("last_operation"),
    assignedAt: integer("assigned_at"),
  },
  (t) => [
    uniqueIndex("clip_sequence").on(t.clipId, t.seq),
    index("frame_queue").on(t.state, t.assignee, t.clipId, t.seq),
  ],
);
export const labels = sqliteTable("labels", {
  frameId: text("frame_id")
    .primaryKey()
    .references(() => frames.id),
  reviewerId: text("reviewer_id").references(() => members.id),
  answer: text("answer").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const revisions = sqliteTable("revisions", {
  operationId: text("operation_id").primaryKey(),
  frameId: text("frame_id")
    .notNull()
    .references(() => frames.id),
  reviewerId: text("reviewer_id").references(() => members.id),
  answer: text("answer").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const attempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const reviewJobs = sqliteTable('review_jobs', {
  id:text('id').primaryKey(),requestKey:text('request_key').notNull(),memberId:text('member_id').notNull().references(()=>members.id),
  kind:text('kind').notNull(),title:text('title').notNull(),dependsOn:text('depends_on'),createdAt:integer('created_at').notNull(),
}, t=>[uniqueIndex('review_job_request').on(t.requestKey,t.kind)]);
export const reviewItems = sqliteTable('review_items', {
  id:text('id').primaryKey(),jobId:text('job_id').notNull().references(()=>reviewJobs.id),frameId:text('frame_id').notNull().references(()=>frames.id),kind:text('kind').notNull(),
  position:integer('position').notNull(),status:text('status').notNull().default('pending'),answer:text('answer'),version:integer('version').notNull().default(0),lastOperation:text('last_operation'),updatedAt:integer('updated_at'),
}, t=>[uniqueIndex('review_frame_task').on(t.frameId,t.kind),index('review_job_items').on(t.jobId,t.position)]);
export const reviewChanges = sqliteTable('review_changes', {
  operationId:text('operation_id').primaryKey(),itemId:text('item_id').notNull().references(()=>reviewItems.id),reviewerId:text('reviewer_id').references(()=>members.id),answer:text('answer').notNull(),completed:integer('completed').notNull(),createdAt:integer('created_at').notNull(),
});
