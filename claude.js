import Anthropic from '@anthropic-ai/sdk'
import 'dotenv/config'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildSystemPrompt(products) {
  const productList = products
    .filter(p => !p.is_pack)
    .map(p => {
      const available = p.variants?.filter(v => v.stock > 0) || []
      if (available.length === 0) return null
      const variants = available
        .map(v => {
          const parts = []
          if (v.size) parts.push(v.size)
          if (v.color) parts.push(v.color)
          return `  • ${parts.join(' / ') || 'Standard'} — ${v.selling_price} MAD`
        })
        .join('\n')
      return `📦 ${p.name}\n${variants}`
    })
    .filter(Boolean)
    .join('\n\n')

  return `You are a friendly WhatsApp shopping assistant for a Moroccan online store.

LANGUAGE RULES:
- Detect the language the customer uses: French, English, or Moroccan Darija
- Always reply in the SAME language they used
- For Darija, match their style — Arabic script or franco-arabe (Latin letters)
- Keep messages short and natural, like a real WhatsApp conversation (1-3 sentences max)

AVAILABLE PRODUCTS (in stock only):
${productList || 'No products currently available.'}

ORDER FLOW:
1. Greet the customer warmly
2. Understand what they want
3. Suggest the right product and variant
4. Collect: full name, delivery city, delivery address, quantity
5. Summarize the order and ask for confirmation
6. Once they confirm (yes / oui / iyeh / واه) → call create_order

RULES:
- Never mention products that are not listed above
- If a product is out of stock, apologize and suggest an alternative
- Only call create_order AFTER the customer explicitly confirms their order
- If the customer seems lost or says goodbye, stay helpful and friendly`
}

const tools = [
  {
    name: 'create_order',
    description: 'Create an order in Stocky after the customer has confirmed all details',
    input_schema: {
      type: 'object',
      properties: {
        customer_name:    { type: 'string', description: 'Full name of the customer' },
        customer_city:    { type: 'string', description: 'Delivery city' },
        customer_address: { type: 'string', description: 'Full delivery address' },
        items: {
          type: 'array',
          description: 'List of ordered items',
          items: {
            type: 'object',
            properties: {
              product_name: { type: 'string' },
              quantity:     { type: 'integer', minimum: 1 },
            },
            required: ['product_name', 'quantity'],
          },
        },
      },
      required: ['customer_name', 'customer_city', 'items'],
    },
  },
]

export async function chat(history, products) {
  return await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: buildSystemPrompt(products),
    tools,
    messages: history,
  })
}
