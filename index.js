import express from 'express'
import fs from 'fs'
import 'dotenv/config'
import { Session } from './session.js'

const app = express()
app.use(express.json())

// In-memory session store: storeId (string) → Session
const sessions = new Map()

// ── Auth middleware ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  const secret = req.headers['x-bot-secret']
  if (!secret || secret !== process.env.BOT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }))

// ── Connect a store ───────────────────────────────────────────────────────────
// POST /sessions/:storeId/connect
// Body: { stockyUrl, token, apiKey }
app.post('/sessions/:storeId/connect', async (req, res) => {
  const { storeId } = req.params
  const { stockyUrl, token, apiKey } = req.body

  if (!stockyUrl || !token || !apiKey) {
    return res.status(400).json({ error: 'Missing stockyUrl, token, or apiKey' })
  }

  // Already connected → return status
  const existing = sessions.get(storeId)
  if (existing?.status === 'connected') {
    return res.json({ status: 'connected' })
  }

  // Tear down stale session if any
  if (existing) {
    await existing.stop()
    sessions.delete(storeId)
  }

  const session = new Session(storeId, { storeId, stockyUrl, token, apiKey })
  sessions.set(storeId, session)
  session.start().catch(err => console.error(`[${storeId}] start error:`, err.message))

  res.json({ status: 'connecting' })
})

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/sessions/:storeId/status', (req, res) => {
  const session = sessions.get(req.params.storeId)
  res.json({ status: session?.status ?? 'disconnected' })
})

// ── QR code ───────────────────────────────────────────────────────────────────
app.get('/sessions/:storeId/qr', (req, res) => {
  const session = sessions.get(req.params.storeId)
  if (!session)                          return res.json({ status: 'disconnected' })
  if (session.status === 'connected')    return res.json({ status: 'connected' })
  if (!session.qrData)                   return res.json({ status: session.status })
  res.json({ status: 'qr_pending', qr: session.qrData })
})

// ── Disconnect ────────────────────────────────────────────────────────────────
app.delete('/sessions/:storeId', async (req, res) => {
  const { storeId } = req.params
  const session = sessions.get(storeId)
  if (session) {
    await session.stop()
    sessions.delete(storeId)
    // Remove saved session files so next connect requires a fresh QR scan
    try { fs.rmSync(`./sessions/${storeId}`, { recursive: true, force: true }) } catch {}
  }
  res.json({ success: true })
})

// ── List active sessions (admin) ──────────────────────────────────────────────
app.get('/sessions', (_, res) => {
  const list = []
  for (const [id, s] of sessions) {
    list.push({ storeId: id, status: s.status })
  }
  res.json(list)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🤖 Stocky Bot service running on port ${PORT}`)
})
