const prisma = require("../lib/prisma");
const { fetchApifyDatasetItems } = require("./apifyService");

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

  console.log(`[commentImport] raw items: ${items.length}`);
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

  for (const item of items) {
    const normalized = normalizeCommentItem(item, datasetId);

    if (!normalized || !normalized.commentId) {
      skippedInvalid += 1;
      continue;
    }

    normalizedCount += 1;

    try {
      await prisma.instagramCommentLead.create({
        data: normalized,
      });
      inserted += 1;
    } catch (err) {
      const msg = String(err?.message || "");

      if (
        msg.includes("Unique constraint") ||
        msg.includes("duplicate") ||
        msg.includes("P2002")
      ) {
        duplicates += 1;
        continue;
      }

      console.error("[commentImport] insert failed:", {
        commentId: normalized.commentId,
        commenterUsername: normalized.commenterUsername,
        postUrl: normalized.postUrl,
        error: msg,
      });
      throw err;
    }
  }

  console.log("[commentImport] summary:", {
    rawItems: items.length,
    normalizedCount,
    skippedInvalid,
    inserted,
    duplicates,
  });

  return {
    rawItems: items.length,
    normalizedCount,
    skippedInvalid,
    inserted,
    duplicates,
  };
}

module.exports = {
  importInstagramCommentDataset,
};