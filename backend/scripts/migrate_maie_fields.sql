-- Phase 33 — MICAHSKIN Acquisition Intelligence Engine (MAIE)
-- Adds 18 nullable intelligence fields to scraped_leads.
-- Fully backwards compatible: all columns nullable, no default backfill.
--
-- Run via:
--   psql $DIRECT_URL -f scripts/migrate_maie_fields.sql
-- or paste into Supabase SQL editor.

ALTER TABLE scraped_leads
  ADD COLUMN IF NOT EXISTS "countryConfidence"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "nigeriaConfidence"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "painScore"          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "urgencyScore"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "buyerIntentScore"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "authenticityScore"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "emotionalIntensity" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "leadHeatScore"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "leadSegment"        TEXT,
  ADD COLUMN IF NOT EXISTS "detectedCity"       TEXT,
  ADD COLUMN IF NOT EXISTS "detectedCountry"    TEXT,
  ADD COLUMN IF NOT EXISTS "detectedLanguage"   TEXT,
  ADD COLUMN IF NOT EXISTS "painSignals"        JSONB,
  ADD COLUMN IF NOT EXISTS "buyerSignals"       JSONB,
  ADD COLUMN IF NOT EXISTS "locationSignals"    JSONB,
  ADD COLUMN IF NOT EXISTS "rejectionReason"    TEXT,
  ADD COLUMN IF NOT EXISTS "aiSummary"          TEXT,
  ADD COLUMN IF NOT EXISTS "outreachAngle"      TEXT;

CREATE INDEX IF NOT EXISTS "scraped_leads_leadHeatScore_idx"
  ON scraped_leads ("leadHeatScore");

CREATE INDEX IF NOT EXISTS "scraped_leads_leadSegment_idx"
  ON scraped_leads ("leadSegment");

CREATE INDEX IF NOT EXISTS "scraped_leads_nigeriaConfidence_idx"
  ON scraped_leads ("nigeriaConfidence");

CREATE INDEX IF NOT EXISTS "scraped_leads_rejectionReason_idx"
  ON scraped_leads ("rejectionReason");
