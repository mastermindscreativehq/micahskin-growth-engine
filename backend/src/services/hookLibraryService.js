// Hook Library Service
// Manages saved winning hooks for reuse and performance tracking

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const hookLibraryService = {
  // Save a new hook to the library
  // Called when admin marks a content piece as "winning"
  async saveHook(data) {
    const {
      hook,
      platform,
      pillar,
      painCategory,
      hookType = 'statement', // default type
      performanceNote,
    } = data;

    return prisma.winningHook.create({
      data: {
        hook,
        platform,
        pillar,
        painCategory,
        hookType,
        performanceNote,
        isActive: true,
      },
    });
  },

  // Get hooks from library with optional filters
  async getHooks(filters = {}) {
    const { platform, pillar, painCategory, isActive = true, limit = 50 } = filters;

    const where = { isActive };

    if (platform && platform !== 'all') {
      where.OR = [{ platform }, { platform: 'all' }];
    }

    if (pillar) {
      where.pillar = pillar;
    }

    if (painCategory) {
      where.painCategory = painCategory;
    }

    return prisma.winningHook.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  // Get hooks by platform only (simple filter)
  async getHooksByPlatform(platform, limit = 30) {
    return prisma.winningHook.findMany({
      where: {
        OR: [{ platform }, { platform: 'all' }],
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  // Get hooks by pain category
  async getHooksByCategory(painCategory, limit = 30) {
    return prisma.winningHook.findMany({
      where: {
        painCategory,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  // Get hooks by hook type (question, statement, shock, story, contrarian)
  async getHooksByType(hookType, limit = 20) {
    return prisma.winningHook.findMany({
      where: {
        hookType,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  // Get a random hook for inspiration
  async getRandomHook(filters = {}) {
    const hooks = await this.getHooks({ ...filters, limit: 100 });
    if (hooks.length === 0) return null;
    return hooks[Math.floor(Math.random() * hooks.length)];
  },

  // Deactivate a hook (soft delete)
  async deactivateHook(hookId) {
    return prisma.winningHook.update({
      where: { id: hookId },
      data: { isActive: false },
    });
  },

  // Reactivate a hook
  async reactivateHook(hookId) {
    return prisma.winningHook.update({
      where: { id: hookId },
      data: { isActive: true },
    });
  },

  // Update performance note
  async updatePerformanceNote(hookId, performanceNote) {
    return prisma.winningHook.update({
      where: { id: hookId },
      data: { performanceNote, updatedAt: new Date() },
    });
  },

  // Get all unique combinations (for dashboard aggregation)
  async getHookStats() {
    const hooks = await prisma.winningHook.findMany({
      where: { isActive: true },
    });

    const stats = {
      totalHooks: hooks.length,
      byPlatform: {},
      byPillar: {},
      byCategory: {},
      byType: {},
    };

    hooks.forEach(hook => {
      stats.byPlatform[hook.platform] = (stats.byPlatform[hook.platform] || 0) + 1;
      stats.byPillar[hook.pillar] = (stats.byPillar[hook.pillar] || 0) + 1;
      stats.byCategory[hook.painCategory] = (stats.byCategory[hook.painCategory] || 0) + 1;
      stats.byType[hook.hookType] = (stats.byType[hook.hookType] || 0) + 1;
    });

    return stats;
  },

  // Bulk import hooks (for initial seeding)
  async bulkImportHooks(hooksList) {
    return prisma.winningHook.createMany({
      data: hooksList,
      skipDuplicates: true,
    });
  },

  // Clear all hooks (admin utility, use with caution)
  async clearAllHooks(confirm = false) {
    if (!confirm) {
      throw new Error('Confirmation required to clear all hooks');
    }
    return prisma.winningHook.deleteMany({});
  },
};

module.exports = hookLibraryService;
