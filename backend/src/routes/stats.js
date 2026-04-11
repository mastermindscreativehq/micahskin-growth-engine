const { Router } = require('express')
const prisma = require('../lib/prisma')
const requireAuth = require('../middleware/requireAuth')

const router = Router()

// Protected: admin only
router.get('/', requireAuth, async (req, res) => {
  try {
    const [totalLeads, totalAcademy, leadsByStatus, academyByStatus] = await Promise.all([
      prisma.lead.count(),
      prisma.academyRegistration.count(),
      prisma.lead.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.academyRegistration.groupBy({ by: ['status'], _count: { id: true } }),
    ])

    res.json({
      success: true,
      data: {
        leads: {
          total: totalLeads,
          byStatus: leadsByStatus.reduce((acc, row) => ({ ...acc, [row.status]: row._count.id }), {}),
        },
        academy: {
          total: totalAcademy,
          byStatus: academyByStatus.reduce((acc, row) => ({ ...acc, [row.status]: row._count.id }), {}),
        },
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch stats' })
  }
})

module.exports = router
