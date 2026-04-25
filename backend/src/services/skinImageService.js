"use strict";

const prisma = require("../lib/prisma");
const { sendTelegramToUser } = require("./telegramService");

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN;
const MAX_IMAGES = 5;

const REVIEW_IN_PROGRESS_MSG =
  "Thank you for sharing your details and photos.\n\n" +
  "Our skincare specialist is reviewing your skin condition carefully.\n" +
  "We take this step seriously to avoid recommending the wrong treatment.\n\n" +
  "You will receive your personalized diagnosis shortly.";

/**
 * Resolves a Telegram file_id to a downloadable URL via the getFile API.
 * Returns null on failure — callers should store null rather than crashing.
 */
async function getTelegramFileUrl(fileId, botToken) {
  const token = botToken || LEAD_BOT_TOKEN;
  if (!token) {
    console.warn("[ImageUpload] no bot token — cannot resolve file URL");
    return null;
  }

  try {
    const res  = await fetch("https://api.telegram.org/bot" + token + "/getFile?file_id=" + fileId);
    const data = await res.json();

    if (!data.ok || !data.result || !data.result.file_path) {
      console.warn("[ImageUpload] getFile failed | fileId=" + fileId + ":", data.description || "no file_path");
      return null;
    }

    return "https://api.telegram.org/file/bot" + token + "/" + data.result.file_path;
  } catch (err) {
    console.warn("[ImageUpload] getFile error | fileId=" + fileId + ":", err.message);
    return null;
  }
}

/**
 * Processes an incoming Telegram photo message for a lead in the awaiting_images stage.
 *
 * Flow:
 *   - Max already reached  send "max reached" notice, return
 *   - Save LeadSkinImage record (fileId, fileUniqueId, fileUrl)
 *   - Increment imageUploadCount
 *   - If count reaches MAX_IMAGES  complete the image phase, trigger diagnosis build
 *   - Otherwise  prompt for more photos or SKIP
 *
 * @param {object} message  Telegram message object (must have .photo array)
 * @param {object} lead     Lead record (must have .id, .imageUploadCount, .telegramStage)
 * @param {string} chatId
 */
async function handleIncomingPhoto(message, lead, chatId) {
  const currentCount = lead.imageUploadCount || 0;

  if (currentCount >= MAX_IMAGES) {
    console.log("[ImageUpload] max_reached (already at limit) | leadId=" + lead.id + " count=" + currentCount);
    await sendTelegramToUser(
      chatId,
      "We have already received the maximum " + MAX_IMAGES + " photos for your profile.",
      LEAD_BOT_TOKEN
    ).catch(function() {});
    return;
  }

  const photos = message.photo;
  if (!Array.isArray(photos) || photos.length === 0) return;

  // Telegram sends multiple sizes — use the largest (last element)
  const photo        = photos[photos.length - 1];
  const fileId       = photo.file_id;
  const fileUniqueId = photo.file_unique_id;

  console.log("[ImageUpload] received | leadId=" + lead.id + " fileId=" + fileId + " newCount=" + (currentCount + 1));

  // Resolve download URL (best-effort — null is acceptable)
  const fileUrl = await getTelegramFileUrl(fileId, LEAD_BOT_TOKEN);

  // Persist image record
  await prisma.leadSkinImage.create({
    data: {
      leadId:               lead.id,
      telegramFileId:       fileId,
      telegramFileUniqueId: fileUniqueId,
      fileUrl:              fileUrl || null,
      mimeType:             "image/jpeg",
      status:               "uploaded",
    },
  });

  const newCount  = currentCount + 1;
  const remaining = MAX_IMAGES - newCount;

  const leadUpdate = {
    imageUploadCount:      newCount,
    imageUploadStatus:     "uploaded",
    imageReviewStatus:     "pending",
    telegramLastMessage:   "[photo " + newCount + "/" + MAX_IMAGES + "]",
    telegramLastMessageAt: new Date(),
  };

  if (newCount >= MAX_IMAGES) {
    // Image phase complete — seal the session
    leadUpdate.telegramStage = "intake_complete";

    await prisma.lead.update({ where: { id: lead.id }, data: leadUpdate });

    await prisma.telegramSession.updateMany({
      where: { userId: chatId },
      data:  { stage: "DONE", completed: true },
    });

    console.log("[ImageUpload] max_reached | leadId=" + lead.id + " total=" + newCount);

    await sendTelegramToUser(chatId, REVIEW_IN_PROGRESS_MSG, LEAD_BOT_TOKEN)
      .catch(function(err) { console.error("[ImageUpload] max confirmation send failed:", err.message); });

    // Build diagnosis data async — Action Engine sends it later after the delay
    console.log("[Diagnosis] waiting_for_image_review | leadId=" + lead.id);
    const { diagnoseLead } = require("./diagnosisEngineService");
    setImmediate(function() {
      diagnoseLead(lead.id).catch(function(err) {
        console.error("[ImageUpload] diagnoseLead failed for lead " + lead.id + ":", err.message);
      });
    });

  } else {
    await prisma.lead.update({ where: { id: lead.id }, data: leadUpdate });

    await sendTelegramToUser(
      chatId,
      "Photo " + newCount + " received. You can send " + remaining + " more, or type SKIP to continue.",
      LEAD_BOT_TOKEN
    ).catch(function(err) { console.error("[ImageUpload] receipt confirmation send failed:", err.message); });
  }
}

module.exports = { getTelegramFileUrl, handleIncomingPhoto };
