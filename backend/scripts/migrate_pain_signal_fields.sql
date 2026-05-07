-- Phase 35 — MICAHSKIN Pain Signal Classifier
-- Adds 10 nullable classifier fields to scraped_leads.
-- Fully backwards compatible: all columns nullable, no default backfill.
--
-- Run via:
--   psql $DIRECT_URL -f scripts/migrate_pain_signal_fields.sql
-- or paste into Supabase SQL editor.

ALTER TABLE scraped_leads
  ADD COLUMN IF NOT EXISTS "painSignalScore"        INTEGER,
  ADD COLUMN IF NOT EXISTS "buyerReadinessScore"    INTEGER,
  ADD COLUMN IF NOT EXISTS "emotionalPainLevel"     INTEGER,
  ADD COLUMN IF NOT EXISTS "problemAwarenessLevel"  TEXT,
  ADD COLUMN IF NOT EXISTS "buyingStage"            TEXT,
  ADD COLUMN IF NOT EXISTS "matchedPainSignals"     JSONB,
  ADD COLUMN IF NOT EXISTS "matchedBuyerSignals"    JSONB,
  ADD COLUMN IF NOT EXISTS "leadQuality"            TEXT,
  ADD COLUMN IF NOT EXISTS "leadQualityReason"      TEXT,
  ADD COLUMN IF NOT EXISTS "recommendedAction"      TEXT;

CREATE INDEX IF NOT EXISTS "scraped_leads_leadQuality_idx"
  ON scraped_leads ("leadQuality");

CREATE INDEX IF NOT EXISTS "scraped_leads_buyingStage_idx"
  ON scraped_leads ("buyingStage");

CREATE INDEX IF NOT EXISTS "scraped_leads_recommendedAction_idx"
  ON scraped_leads ("recommendedAction");

CREATE INDEX IF NOT EXISTS "scraped_leads_painSignalScore_idx"
  ON scraped_leads ("painSignalScore");

CREATE INDEX IF NOT EXISTS "scraped_leads_buyerReadinessScore_idx"
  ON scraped_leads ("buyerReadinessScore");
