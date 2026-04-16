-- Phase 22: Conversation Brain + Reply Governor
-- Run this against your Supabase/PostgreSQL database before deploying.
-- All columns are nullable or have safe defaults — fully backwards compatible.
--
-- Run via:
--   psql $DATABASE_URL -f scripts/migrate_conversation_brain.sql
-- or paste into Supabase SQL editor.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS "conversationMode"      TEXT,
  ADD COLUMN IF NOT EXISTS "activeOffer"           TEXT,
  ADD COLUMN IF NOT EXISTS "awaitingReplyFor"      TEXT,
  ADD COLUMN IF NOT EXISTS "botMutedUntil"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "followupSuppressed"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastBotIntent"         TEXT,
  ADD COLUMN IF NOT EXISTS "lastUserIntent"        TEXT,
  ADD COLUMN IF NOT EXISTS "lastMeaningfulBotAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastMeaningfulUserAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "academyPitchCount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "productOfferCount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "consultOfferCount"     INTEGER NOT NULL DEFAULT 0;
