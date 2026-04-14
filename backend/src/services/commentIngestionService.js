const prisma = require("../lib/prisma");
const { fetchApifyDatasetItems } = require("./apifyService");
const { diagnoseLead } = require("./diagnosisEngineService");

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeCommentItem(item, sourceDatasetId) {
  if (!item || typeof item !== "object") return null;

  const commentId =
    item.id?.toString?.() ||
    item.commentId?.toString?.() ||
    null;

  const commentText =
    item.text ||
    item.comment ||
    item.content ||
    null;

  const postUrl =
    item.postUrl ||
    item.postURL ||
    item.url ||
    null;

  const commenterUsername =
    item.ownerUsername ||
    item.commenterUsername ||
    item.username ||
    null;

  const commenterProfilePicUrl =
    item.ownerProfilePicUrl ||
    item.commenterProfilePicUrl ||
    item.profilePicUrl ||
    null;

  const commentedAt =
    parseDate(item.timestamp || item.commentedAt || item.createdAt);

  return {
    platform: "instagram",
    sourceDatasetId,
    commentId,
    postUrl,
    commentText,
    commentedAt,
    commenterUsername,
    commenterProfilePicUrl,
    ownerUsername: item.ownerUsername || null,
    rawJson: item,
  };
}

async function importInstagramCommentDataset(datasetId) {
  if (!datasetId) {
    throw new Error("datasetId is required");
  }

  console.log(`[commentImport] fetching dataset ${datasetId}`);

  const items = await fetchApifyDatasetItems(datasetId);

  console.log(`[commentImport] raw items received: ${items.length}`);
  console.log(
    "[commentImport] sample items:",
    items.slice(0, 3).map((i) => ({
      id: i?.id,
      text: i?.text,
      postUrl: i?.postUrl,
      ownerUsername: i?.ownerUsername,
    }))
  );

  let normalizedCount = 0;
  let skippedInvalid = 0;
  let inserted = 0;
  let duplicates = 0;
  let leadsCreated = 0;
  let leadsDuplicate = 0;
  const firstFiveLeadUsernames = [];

  for (const item of items) {
    const normalized = normalizeCommentItem(item, datasetId);

    if (!normalized || !normalized.commentId) {
      skippedInvalid += 1;
      continue;
    }

    normalizedCount += 1;

    // ── Step 1: Insert into InstagramCommentLead (staging / audit table) ──
    let commentRowInserted = false;
    try {
      await prisma.instagramCommentLead.create({
        data: normalized,
      });
      inserted += 1;
      commentRowInserted = true;
    } catch (err) {
      const msg = String(err?.message || "");

      if (
        msg.includes("Unique constraint") ||
        msg.includes("duplicate") ||
        msg.includes("P2002")
      ) {
        // This comment was already processed on a prior run — skip the CRM
        // upsert too so we don't double-count the same commenter.
        duplicates += 1;
        continue;
      }

      console.error("[commentImport] instagramCommentLead insert failed:", {
        commentId: normalized.commentId,
        commenterUsername: normalized.commenterUsername,
        postUrl: normalized.postUrl,
        error: msg,
      });
      throw err;
    }

    // ── Step 2: Upsert into Lead (real CRM table visible to dashboard) ────
    // Only proceed if the staging row was freshly inserted and we have a
    // username to key the deduplication on.
    if (commentRowInserted && normalized.commenterUsername) {
      const handle = normalized.commenterUsername;

      // One CRM lead per unique commenter username (Instagram + comment).
      const existing = await prisma.lead.findFirst({
        where: {
          handle,
          sourcePlatform: "Instagram",
          sourceType: "comment",
        },
        select: { id: true },
      });

      if (!existing) {
        const fullName = `@${handle}`;
        const message =
          normalized.commentText || "(imported from Instagram comment)";

        const newLead = await prisma.lead.create({
          data: {
            fullName,
            sourcePlatform: "Instagram",
            sourceType: "comment",
            handle,
            skinConcern: "other",
            message,
            status: "new",
            priority: "low",
            campaign: normalized.postUrl || null,
            suggestedReply: `Hi ${fullName}! I noticed your comment and wanted to reach out directly. Would you like me to walk you through what would work best for you?`,
          },
        });

        // Run diagnosis asynchronously — do not block the import loop
        setImmediate(() => {
          diagnoseLead(newLead.id).catch((err) =>
            console.error(`[CommentImport] Diagnosis failed for lead ${newLead.id}:`, err.message)
          )
        })

        leadsCreated += 1;
        if (firstFiveLeadUsernames.length < 5) {
          firstFiveLeadUsernames.push(handle);
        }
      } else {
        leadsDuplicate += 1;
      }
    }
  }

  // ── Debug summary ──────────────────────────────────────────────────────────
  console.log("[commentImport] ── IMPORT COMPLETE ──────────────────────────");
  console.log(`[commentImport]   staging table : instagram_comment_leads`);
  console.log(`[commentImport]   CRM table     : leads`);
  console.log(`[commentImport]   raw items     : ${items.length}`);
  console.log(`[commentImport]   valid items   : ${normalizedCount}`);
  console.log(`[commentImport]   skipped (no commentId): ${skippedInvalid}`);
  console.log(`[commentImport]   comment rows inserted : ${inserted}`);
  console.log(`[commentImport]   comment rows skipped (dup): ${duplicates}`);
  console.log(`[commentImport]   CRM leads created     : ${leadsCreated}`);
  console.log(`[commentImport]   CRM leads skipped (dup): ${leadsDuplicate}`);
  console.log(
    `[commentImport]   first 5 lead usernames: ${
      firstFiveLeadUsernames.length
        ? firstFiveLeadUsernames.join(", ")
        : "(none)"
    }`
  );
  console.log("[commentImport] ─────────────────────────────────────────────");

  return {
    rawItems: items.length,
    normalizedCount,
    skippedInvalid,
    inserted,
    duplicates,
    leadsCreated,
    leadsDuplicate,
  };
}

module.exports = {
  importInstagramCommentDataset,
};
