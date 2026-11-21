CREATE TABLE `events` (
	`exam` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`occurred` integer NOT NULL,
	`pcs` text NOT NULL,
	`names` text NOT NULL,
	PRIMARY KEY(`exam`, `id`)
);
--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`started` integer NOT NULL,
	`ended` integer,
	`slot` integer DEFAULT 1 NOT NULL,
	`freshness` integer DEFAULT 2000 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_exam` ON `exams` (`slot`) WHERE ended IS NULL;--> statement-breakpoint
CREATE TABLE `stations` (
	`exam` text NOT NULL,
	`pc` text NOT NULL,
	`name` text,
	`section` text,
	`seen` integer,
	`behavior` text,
	`stale` integer DEFAULT 0 NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`exam`, `pc`)
);
