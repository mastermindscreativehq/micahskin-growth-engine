const { Router } = require('express')

const router = Router()

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    system: 'MICAHSKIN Growth Engine',
    timestamp: new Date().toISOString(),
  })
})

module.exports = router
