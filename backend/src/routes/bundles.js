'use strict'

const { Router } = require('express')
const requireAuth = require('../middleware/requireAuth')
const controller = require('../controllers/bundlesController')

const router = Router()

// Public — read-only, published bundles only. Mounted under /public to avoid
// any path collision with the admin /:id routes below.
router.get('/public/:slug', controller.getPublicBySlug)

// Admin — everything else requires an authenticated session.
router.use(requireAuth)

router.get('/', controller.list)
router.post('/', controller.create)
router.get('/:id', controller.getById)
router.patch('/:id', controller.update)
router.patch('/:id/status', controller.setStatus)
router.post('/:id/items', controller.addItem)
router.delete('/:id/items/:itemId', controller.removeItem)
router.patch('/:id/items/reorder', controller.reorderItems)

module.exports = router
