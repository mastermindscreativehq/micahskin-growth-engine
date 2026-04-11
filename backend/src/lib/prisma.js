const { PrismaClient } = require('@prisma/client')

// Single shared instance — prevents too many connections during dev hot-reload
const prisma = new PrismaClient()

module.exports = prisma
