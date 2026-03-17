import axios from 'axios'

/**
 * Create a Stocky API client for a specific store.
 * Uses a pre-generated auth token (passed from Stocky backend on connect).
 */
export function createStockyClient({ stockyUrl, token, apiKey }) {
  const http = axios.create({
    baseURL: stockyUrl,
    headers: { Authorization: `Bearer ${token}` },
  })

  return {
    async getProducts() {
      const res = await http.get('/api/products')
      return res.data
    },

    async createLead(data) {
      const res = await axios.post(
        `${stockyUrl}/api/leads/inbound?api_key=${apiKey}`,
        data
      )
      return res.data
    },
  }
}
