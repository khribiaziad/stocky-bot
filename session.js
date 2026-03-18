import pkg from '@whiskeysockets/baileys'
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = pkg
import pino from 'pino'
import QRCode from 'qrcode'
import { handleMessage, clearStoreCache } from './bot.js'

const logger = pino({ level: 'warn' })

export class Session {
  constructor(storeId, config) {
    this.storeId  = storeId
    this.config   = config  // { storeId, stockyUrl, token, apiKey }
    this.status   = 'connecting'
    this.qrData   = null   // base64 PNG data URL
    this.sock     = null
    this._stopped = false
  }

  async start() {
    if (this._stopped) return

    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${this.storeId}`)
    const { version } = await fetchLatestBaileysVersion()

    this.sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ['Stocky Bot', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
    })

    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        this.status = 'qr_pending'
        try {
          this.qrData = await QRCode.toDataURL(qr)
        } catch {}
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode
        const reason = lastDisconnect?.error?.message || 'unknown'
        const loggedOut = code === DisconnectReason.loggedOut
        console.log(`[${this.storeId}] Connection closed — code: ${code}, reason: ${reason}, loggedOut: ${loggedOut}`)
        this.status = 'disconnected'
        this.qrData = null
        if (!loggedOut && !this._stopped) {
          console.log(`[${this.storeId}] Reconnecting in 5s...`)
          setTimeout(() => this.start(), 5000)
        }
      } else if (connection === 'open') {
        this.status = 'connected'
        this.qrData = null
        console.log(`✅ [${this.storeId}] WhatsApp connected`)
      } else if (connection) {
        console.log(`[${this.storeId}] Connection state: ${connection}`)
      }
    })

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue
        const jid = msg.key.remoteJid
        if (!jid || jid.endsWith('@g.us')) continue

        const phone = jid.split('@')[0]
        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          ''

        if (!text.trim()) continue

        try {
          const reply = await handleMessage(phone, text, this.config)
          await this.sock.sendMessage(jid, { text: reply })
        } catch (err) {
          console.error(`[${this.storeId}] Message error:`, err.message)
          await this.sock.sendMessage(jid, {
            text: 'Sorry, something went wrong. Please try again.',
          }).catch(() => {})
        }
      }
    })
  }

  async stop() {
    this._stopped = true
    this.status = 'disconnected'
    this.qrData = null
    clearStoreCache(this.storeId)
    try { await this.sock?.logout() } catch {}
    try { this.sock?.end() } catch {}
    this.sock = null
  }
}
