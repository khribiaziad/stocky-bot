import { chat } from './claude.js'
import { createStockyClient } from './stocky.js'

// Conversations: key = `${storeId}:${phone}`
const conversations = new Map()
const TIMEOUT_MS = 30 * 60 * 1000

// Products cache per store
const productCache = new Map()  // storeId → { products, cachedAt }
const PRODUCTS_TTL = 5 * 60 * 1000

function getConversation(key) {
  const existing = conversations.get(key)
  if (existing && Date.now() - existing.lastActive < TIMEOUT_MS) {
    existing.lastActive = Date.now()
    return existing
  }
  const conv = { history: [], lastActive: Date.now() }
  conversations.set(key, conv)
  return conv
}

async function getProducts(storeId, config) {
  const cache = productCache.get(storeId)
  if (cache && Date.now() - cache.cachedAt < PRODUCTS_TTL) {
    return cache.products
  }
  const client = createStockyClient(config)
  const products = await client.getProducts()
  productCache.set(storeId, { products, cachedAt: Date.now() })
  return products
}

export function clearStoreCache(storeId) {
  productCache.delete(storeId)
  for (const key of conversations.keys()) {
    if (key.startsWith(`${storeId}:`)) conversations.delete(key)
  }
}

export async function handleMessage(phone, text, config) {
  const { storeId } = config
  const key = `${storeId}:${phone}`
  const conv = getConversation(key)
  const products = await getProducts(storeId, config)

  conv.history.push({ role: 'user', content: text })

  const response = await chat(conv.history, products)

  if (response.stop_reason === 'tool_use') {
    const toolBlock = response.content.find(b => b.type === 'tool_use')

    if (toolBlock?.name === 'create_order') {
      const orderData = toolBlock.input
      conv.history.push({ role: 'assistant', content: response.content })

      const stocky = createStockyClient(config)
      let toolResult
      try {
        const result = await stocky.createLead({
          customer_name:    orderData.customer_name,
          customer_phone:   phone,
          customer_city:    orderData.customer_city || '',
          customer_address: orderData.customer_address || '',
          items:            orderData.items,
        })
        toolResult = { success: true, lead_id: result.id }
        conversations.delete(key)
      } catch (err) {
        toolResult = { success: false, error: err.message }
      }

      conv.history.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(toolResult),
        }],
      })

      const final = await chat(conv.history, products)
      const finalText =
        final.content.find(b => b.type === 'text')?.text ||
        '✅ Your order has been placed! We will contact you soon.'

      conv.history.push({ role: 'assistant', content: final.content })
      return finalText
    }
  }

  const replyText =
    response.content.find(b => b.type === 'text')?.text ||
    'Sorry, something went wrong. Please try again.'

  conv.history.push({ role: 'assistant', content: response.content })
  return replyText
}
